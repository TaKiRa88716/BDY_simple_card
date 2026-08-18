import os
import sys
import uuid
import socket
import base64
import io
import webbrowser
from threading import Timer

# 強制控制台輸出採用 UTF-8 編碼 (防止 Windows CP950 終端機 Emoji 報錯)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from flask import Flask, render_template, request, jsonify, send_from_directory, url_for, send_file
import qrcode
import openpyxl
import csv
import zipfile
import subprocess
import re
import json
from PIL import Image as PILImage

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response

# 確保 static/cards、results 與 隊伍Logo 資料夾存在
CARDS_DIR = os.path.join(app.static_folder, 'cards')
RESULTS_DIR = os.path.join(app.root_path, 'results')
TEAM_LOGO_DIR = os.path.join(app.root_path, '隊伍Logo')
CONFIG_DIR = os.path.join(app.static_folder, 'config')
LAYOUT_PATH = os.path.join(CONFIG_DIR, 'card_layout.json')
TEMPLATE_IMG_PATH = os.path.join(app.static_folder, 'images', 'card_template.jpg')
os.makedirs(CARDS_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(TEAM_LOGO_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)

def sanitize_filename(name):
    """清理 Windows 檔案名稱中的非法字元"""
    return re.sub(r'[\\/*?:"<>|]', '', str(name)).strip()

@app.route('/team_logo/<path:filename>')
def serve_team_logo(filename):
    """提供隊伍 Logo 圖檔存取"""
    return send_from_directory(TEAM_LOGO_DIR, filename)

@app.route('/api/list_team_logos')
def list_team_logos():
    """列出 隊伍Logo 資料夾中所有可用的 Logo 圖檔"""
    try:
        logos = {}
        for fname in os.listdir(TEAM_LOGO_DIR):
            if fname.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.svg')):
                stem = os.path.splitext(fname)[0].strip()
                logos[stem] = url_for('serve_team_logo', filename=fname)
        return jsonify({'success': True, 'logos': logos})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/upload_team_logo', methods=['POST'])
def upload_team_logo():
    """上傳隊伍 Logo 圖檔 (支援 PNG, JPG, WEBP, SVG)"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': '未找到上傳圖檔'}), 400
        
        file = request.files['file']
        if not file or file.filename == '':
            return jsonify({'success': False, 'error': '未選擇檔案'}), 400

        team_name = request.form.get('team_name', '').strip()
        orig_name = sanitize_filename(file.filename)
        ext = os.path.splitext(orig_name)[1].lower()
        if not ext:
            ext = '.png'

        target_name = f"{sanitize_filename(team_name)}{ext}" if team_name else orig_name
        filepath = os.path.join(TEAM_LOGO_DIR, target_name)
        file.save(filepath)

        stem = os.path.splitext(target_name)[0]
        logo_url = url_for('serve_team_logo', filename=target_name)

        return jsonify({
            'success': True,
            'team_name': stem,
            'filename': target_name,
            'logo_url': logo_url
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/upload_template', methods=['POST'])
def upload_template():
    """更換卡片模板底圖：存成 static/images/card_template.jpg，並同步更新版面設定檔的畫布尺寸"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': '未找到上傳圖檔'}), 400

        file = request.files['file']
        if not file or file.filename == '':
            return jsonify({'success': False, 'error': '未選擇檔案'}), 400

        try:
            img = PILImage.open(file.stream)
            img = img.convert('RGB')
        except Exception:
            return jsonify({'success': False, 'error': '無法辨識的圖片格式，請上傳 JPG / PNG / WEBP'}), 400

        os.makedirs(os.path.dirname(TEMPLATE_IMG_PATH), exist_ok=True)
        img.save(TEMPLATE_IMG_PATH, format='JPEG', quality=95)
        width, height = img.size

        # 同步更新設定檔的畫布尺寸，讓所有欄位的相對座標套用到新模板上
        if os.path.exists(LAYOUT_PATH):
            with open(LAYOUT_PATH, 'r', encoding='utf-8') as f:
                layout = json.load(f)
            layout['canvasWidth'] = width
            layout['canvasHeight'] = height
            with open(LAYOUT_PATH, 'w', encoding='utf-8') as f:
                json.dump(layout, f, ensure_ascii=False, indent=2)

        return jsonify({'success': True, 'width': width, 'height': height})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/save_layout', methods=['POST'])
def save_layout():
    """把前端調整過的欄位/Logo位置版面設定寫回 static/config/card_layout.json"""
    try:
        layout = request.get_json(force=True)
        if not isinstance(layout, dict) or 'fields' not in layout or 'logo' not in layout:
            return jsonify({'success': False, 'error': '版面設定格式不正確'}), 400

        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(LAYOUT_PATH, 'w', encoding='utf-8') as f:
            json.dump(layout, f, ensure_ascii=False, indent=2)

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

def format_jersey_number(num_val):
    """背號格式化：個位數自動補 0 (例如: 1 -> 01, 3 -> 03, 18 -> 18)"""
    if num_val is None:
        return '00'
    s = str(num_val).strip()
    if s.endswith('.0'): # 處理 Excel 浮點數轉換
        s = s[:-2]
    # 若為純數字且只有一位數，前面補 0
    if s.isdigit() and len(s) == 1:
        return f"0{s}"
    return s

def get_local_ip():
    """取得地端區域網路 (LAN) IP 位址，方便同 Wi-Fi 下的手機掃碼"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/parse_batch_file', methods=['POST'])
def parse_batch_file():
    """解析上傳的 Excel (.xlsx/.xls) 或 CSV (.csv) 檔案"""
    def find_team_logo_url(team):
        if not team or not os.path.exists(TEAM_LOGO_DIR):
            return None
        clean_team = sanitize_filename(str(team)).strip().lower()
        files = [f for f in os.listdir(TEAM_LOGO_DIR) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.svg'))]
        
        # 1. Exact match (case-insensitive)
        for fname in files:
            stem = os.path.splitext(fname)[0].strip().lower()
            if stem == clean_team:
                return url_for('serve_team_logo', filename=fname)
        
        # 2. Sort candidate files by stem length descending (so "白巴豆妖" / "黑巴豆妖" matches before "巴豆妖")
        files_by_len = sorted(files, key=lambda f: len(os.path.splitext(f)[0].strip()), reverse=True)
        for fname in files_by_len:
            stem = os.path.splitext(fname)[0].strip().lower()
            if stem in clean_team or clean_team in stem:
                return url_for('serve_team_logo', filename=fname)
        return None

    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': '未找到上傳檔案'}), 400

        file = request.files['file']
        if not file or file.filename == '':
            return jsonify({'success': False, 'error': '未選擇有效檔案'}), 400

        filename = file.filename.lower()
        items = []

        if filename.endswith('.xlsx') or filename.endswith('.xls'):
            # 讀取 Excel
            wb = openpyxl.load_workbook(file, data_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))
            if not rows:
                return jsonify({'success': False, 'error': 'Excel 檔案為空'}), 400

            # 辨識標題列索引
            header = [str(cell).strip() if cell is not None else '' for cell in rows[0]]
            team_idx = 0
            name_idx = 1
            num_idx = 2

            for i, h in enumerate(header):
                if any(k in h for k in ['隊伍', '學校', 'team']):
                    team_idx = i
                elif any(k in h for k in ['隊員', '選手', '姓名', 'name', 'player']):
                    name_idx = i
                elif any(k in h for k in ['背號', '球衣', '號碼', 'number', 'no', 'jersey']):
                    num_idx = i

            for r in rows[1:]:
                if not r or all(cell is None or str(cell).strip() == '' for cell in r):
                    continue
                team = str(r[team_idx]).strip() if team_idx < len(r) and r[team_idx] is not None else '排球隊'
                name = str(r[name_idx]).strip() if name_idx < len(r) and r[name_idx] is not None else '選手'
                raw_num = r[num_idx] if num_idx < len(r) else '0'
                jersey = format_jersey_number(raw_num)
                logo_url = find_team_logo_url(team)

                items.append({
                    'teamName': team,
                    'playerName': name,
                    'jerseyNumber': jersey,
                    'logoUrl': logo_url,
                    'hasLogo': logo_url is not None,
                    'targetFilename': f"{sanitize_filename(team)}_{sanitize_filename(name)}.png"
                })

        elif filename.endswith('.csv'):
            # 讀取 CSV (支援 UTF-8-SIG、UTF-8、CP950/BIG5)
            content_bytes = file.read()
            text_content = None
            for encoding in ['utf-8-sig', 'utf-8', 'cp950', 'big5', 'gbk']:
                try:
                    text_content = content_bytes.decode(encoding)
                    break
                except Exception:
                    continue

            if not text_content:
                return jsonify({'success': False, 'error': '無法解析 CSV 編碼'}), 400

            reader = csv.reader(io.StringIO(text_content))
            rows = [r for r in reader if any(cell.strip() for cell in r)]
            if not rows:
                return jsonify({'success': False, 'error': 'CSV 檔案為空'}), 400

            header = [str(c).strip() for c in rows[0]]
            team_idx = 0
            name_idx = 1
            num_idx = 2

            for i, h in enumerate(header):
                if any(k in h for k in ['隊伍', '學校', 'team']):
                    team_idx = i
                elif any(k in h for k in ['隊員', '選手', '姓名', 'name', 'player']):
                    name_idx = i
                elif any(k in h for k in ['背號', '球衣', '號碼', 'number', 'no', 'jersey']):
                    num_idx = i

            for r in rows[1:]:
                if not r:
                    continue
                team = r[team_idx].strip() if team_idx < len(r) else '排球隊'
                name = r[name_idx].strip() if name_idx < len(r) else '選手'
                raw_num = r[num_idx] if num_idx < len(r) else '0'
                jersey = format_jersey_number(raw_num)
                logo_url = find_team_logo_url(team)

                items.append({
                    'teamName': team,
                    'playerName': name,
                    'jerseyNumber': jersey,
                    'logoUrl': logo_url,
                    'hasLogo': logo_url is not None,
                    'targetFilename': f"{sanitize_filename(team)}_{sanitize_filename(name)}.png"
                })
        else:
            return jsonify({'success': False, 'error': '僅支援 .xlsx、.xls 或 .csv 格式'}), 400

        if not items:
            return jsonify({'success': False, 'error': '未讀取到有效的隊員資料列'}), 400

        return jsonify({
            'success': True,
            'count': len(items),
            'items': items
        })

    except Exception as e:
        return jsonify({'success': False, 'error': f'解析檔案失敗: {str(e)}'}), 500

@app.route('/api/save_batch_card', methods=['POST'])
def save_batch_card():
    """儲存批次生成的卡片圖檔至 results 資料夾 (檔名: 隊伍名稱_隊員名稱.png)"""
    try:
        data = request.get_json()
        team_name = sanitize_filename(data.get('team_name', '排球隊'))
        player_name = sanitize_filename(data.get('player_name', '選手'))
        image_data = data.get('image_data', '')

        if not image_data or not image_data.startswith('data:image/png;base64,'):
            return jsonify({'success': False, 'error': '無效的圖片資料'}), 400

        # 解碼 Base64 PNG 圖檔
        header, encoded = image_data.split(',', 1)
        file_bytes = base64.b64decode(encoded)

        # 檔名規範：隊伍名稱_隊員名稱.png
        filename = f"{team_name}_{player_name}.png"
        filepath = os.path.join(RESULTS_DIR, filename)

        with open(filepath, 'wb') as f:
            f.write(file_bytes)

        return jsonify({
            'success': True,
            'filename': filename,
            'path': filepath
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/open_results_folder', methods=['POST'])
def open_results_folder():
    """開啟地端 results 結果資料夾"""
    try:
        if os.name == 'nt':
            os.startfile(RESULTS_DIR)
        else:
            subprocess.Popen(['xdg-open', RESULTS_DIR])
        return jsonify({'success': True, 'path': RESULTS_DIR})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/download_results_zip', methods=['GET'])
def download_results_zip():
    """將 results 資料夾中所有圖片打包成 ZIP 供一鍵下載"""
    try:
        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(RESULTS_DIR):
                for file in files:
                    if file.lower().endswith('.png'):
                        file_path = os.path.join(root, file)
                        zf.write(file_path, arcname=file)
        
        memory_file.seek(0)
        return send_file(
            memory_file,
            download_name='Volleyball_Cards_Results.zip',
            as_attachment=True,
            mimetype='application/zip'
        )
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/generate_qr', methods=['POST'])
def generate_qr():
    try:
        data = request.get_json()
        image_data = data.get('image_data', '')
        
        if not image_data or not image_data.startswith('data:image/png;base64,'):
            return jsonify({'success': False, 'error': '無效的圖片資料'}), 400

        # 解碼 Base64 PNG 圖檔
        header, encoded = image_data.split(',', 1)
        file_bytes = base64.b64decode(encoded)

        # 產生獨一無二的 Card ID
        card_id = f"card_{uuid.uuid4().hex[:10]}"
        filename = f"{card_id}.png"
        filepath = os.path.join(CARDS_DIR, filename)

        # 儲存圖檔
        with open(filepath, 'wb') as f:
            f.write(file_bytes)

        # 建立存取 URL (優先使用 LAN IP，讓手機掃描同 Wi-Fi 即可開啟)
        host_ip = get_local_ip()
        port = 5000
        card_url = f"http://{host_ip}:{port}/view_card/{card_id}"

        # 產生 QR Code 圖片 (Base64)
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=8,
            border=2,
        )
        qr.add_data(card_url)
        qr.make(fit=True)

        img_qr = qr.make_image(fill_color="#ff6b00", back_color="#141923")
        buffered = io.BytesIO()
        img_qr.save(buffered, format="PNG")
        qr_base64 = "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode('utf-8')

        return jsonify({
            'success': True,
            'card_id': card_id,
            'card_url': card_url,
            'qr_code': qr_base64,
            'card_img_url': url_for('static', filename=f'cards/{filename}', _external=True)
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/view_card/<card_id>')
def view_card(card_id):
    filename = f"{card_id}.png"
    filepath = os.path.join(CARDS_DIR, filename)
    
    if not os.path.exists(filepath):
        return "身分證圖檔不存在或已過期", 404
        
    card_img_url = url_for('static', filename=f'cards/{filename}')
    return render_template('view_card.html', card_img_url=card_img_url, card_id=card_id)

def open_browser():
    try:
        webbrowser.open_new('http://127.0.0.1:5000/')
    except Exception:
        pass

if __name__ == '__main__':
    local_ip = get_local_ip()
    print("=" * 60)
    print(" [Volleyball Player ID Studio] 排球員身分證生成器")
    print(" 實體卡片規格: 79.7 mm x 48 mm (高畫質 300 DPI 繪製)")
    print(f" 本地電腦開啟: http://127.0.0.1:5000/")
    print(f" 手機同網域開啟: http://{local_ip}:5000/")
    print("=" * 60)
    
    Timer(1.2, open_browser).start()
    app.run(host='0.0.0.0', port=5000, debug=False)
