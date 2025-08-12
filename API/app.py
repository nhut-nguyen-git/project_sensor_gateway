# -*- coding: utf-8 -*-
from flask import Flask, jsonify, request, send_from_directory, session
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash
from functools import wraps
import sqlite3
import os
import time
import subprocess
import re
import math # Thêm thư viện math

from pyngrok import ngrok
from flask import g
# ============================================================================
# 1. C?U H�NH V� C�C BI?N TO�N C?C
# ============================================================================

# Xác định thư mục chứa file app.py (tức là thư mục API)
SCRIPT_DIR = os.path.abspath(os.path.dirname(__file__))
# Đi lùi một cấp để lấy thư mục gốc của toàn bộ dự án
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Xây dựng tất cả các đường dẫn từ thư mục gốc của dự án
WEB_DIR = os.path.join(PROJECT_ROOT, "web")
DB_FILE = os.path.join(PROJECT_ROOT, "Sensor.db")
LOG_FILE = os.path.join(PROJECT_ROOT, 'gateway.log')
SENSOR_MAP_FILE = os.path.join(PROJECT_ROOT, 'room_sensor.map')
TYPE_MAP_FILE = os.path.join(PROJECT_ROOT, 'type.map')

# Khởi tạo Flask App với đường dẫn đến thư mục 'web' đã được sửa đúng
app = Flask(__name__, static_folder=WEB_DIR, static_url_path='')

# Kh?i t?o Flask App, gi? l?i static_folder b?n d� d?nh nghia
app = Flask(__name__, static_folder=WEB_DIR, static_url_path='')
CORS(app)

# B?T BU?C: Th�m m?t kh�a b� m?t d? qu?n l� session an to�n
app.secret_key = os.urandom(24)

# ============================================================================
# 2. QU?N L� NGU?I D�NG & M?T KH?U (DATABASE GI? L?P)
# ============================================================================
# M?t kh?u g?c cho c? 2 t�i kho?n d?u l� '123'
USERS = {
    'admin': {
        'password': generate_password_hash('123'),
        'role': 'admin'
    },
    'user': {
        'password': generate_password_hash('123'),
        'role': 'user'
    }
}

# ============================================================================
# 3. DECORATORS �? B?O V? V� PH�N QUY?N API
# ============================================================================

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            return jsonify({"error": "Authentication required, please log in."}), 401
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            return jsonify({"error": "Authentication required, please log in."}), 401
        if session.get('role') != 'admin':
            return jsonify({"error": "Administrator access required."}), 403
        return f(*args, **kwargs)
    return decorated_function

# ============================================================================
# 4. C�C API ENDPOINT M?I CHO VI?C X�C TH?C
# ============================================================================

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({"error": "Missing username or password"}), 400

    username = data['username']
    password = data['password']
    user_data = USERS.get(username)

    if user_data and check_password_hash(user_data['password'], password):
        session['username'] = username
        session['role'] = user_data['role']
        return jsonify({"status": "success", "role": user_data['role']})

    return jsonify({"error": "Invalid username or password"}), 401

@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"status": "success"})

@app.route('/check-session', methods=['GET'])
def check_session():
    if 'username' in session:
        return jsonify({
            "logged_in": True,
            "username": session['username'],
            "role": session['role']
        })
    return jsonify({"logged_in": False}), 401

# ============================================================================
# 5. C�C API HI?N C� C?A B?N (�� �U?C T�CH H?P B?O V?)
# ============================================================================

# --- C�c h�m helper c?a b?n (gi? nguy�n) ---
def load_sensor_room_type_map():
    room_map = {}
    type_map = {}
    combined = {}
    if os.path.exists(SENSOR_MAP_FILE):
        with open(SENSOR_MAP_FILE) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) == 2: room_map[int(parts[1])] = int(parts[0])
    if os.path.exists(TYPE_MAP_FILE):
        with open(TYPE_MAP_FILE) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) == 2: type_map[int(parts[0])] = parts[1]
    for sensor_id in set(room_map.keys()) & set(type_map.keys()):
        combined[sensor_id] = {'room_id': room_map[sensor_id], 'type': type_map[sensor_id]}
    return combined

# --- C�c route API c?a b?n (d� th�m decorator) ---

@app.route('/sensors')
@login_required
def get_sensors():
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT sensor_id FROM SensorData")
    data = [row[0] for row in cur.fetchall()]
    conn.close()
    return jsonify(data)

@app.route('/sensor/<int:sensor_id>/latest')
@login_required
def latest(sensor_id):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("SELECT sensor_value, timestamp FROM SensorData WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 1", (sensor_id,))
    row = cur.fetchone()
    conn.close()
    if row: return jsonify({"sensor_value": row[0], "timestamp": row[1]})
    return jsonify({})

@app.route('/sensor/<int:sensor_id>/history')
@login_required
def history(sensor_id):
    from_ts = request.args.get('from', 0)
    to_ts = request.args.get('to', int(time.time()))
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("SELECT sensor_value AS value, timestamp FROM SensorData WHERE sensor_id = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC", (sensor_id, int(from_ts), int(to_ts)))
    rows = cur.fetchall()
    conn.close()
    return jsonify([{"value": row[0], "timestamp": row[1]} for row in rows])

@app.route('/sensor/<int:sensor_id>/range')
@login_required
def time_range(sensor_id):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("SELECT MIN(timestamp), MAX(timestamp) FROM SensorData WHERE sensor_id = ?", (sensor_id,))
    row = cur.fetchone()
    conn.close()
    if row and row[0] is not None: return jsonify({"start": row[0], "end": row[1]})
    return jsonify({})

@app.route('/log')
@admin_required  # <-- CH? ADMIN M?I C� QUY?N
def view_log():
    """
    API nâng cao để đọc, phân tích, tìm kiếm và phân trang file log.
    - Hỗ trợ tìm kiếm qua query param 'search'.
    - Hỗ trợ phân trang qua query param 'page' và 'limit'.
    """
    # Lấy các tham số từ URL, với giá trị mặc định
    page = request.args.get('page', 1, type=int)
    limit = request.args.get('limit', 50, type=int)
    search_query = request.args.get('search', '', type=str).lower()

    log_pattern = re.compile(r'\[(.*?)\]\s\[(.*?)\]\s\[(.*?)\]\s(.*)')
    parsed_logs = []
    
    try:
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        # Lọc log dựa trên query tìm kiếm (nếu có)
        filtered_lines = []
        if search_query:
            for line in lines:
                if search_query in line.lower():
                    filtered_lines.append(line)
        else:
            filtered_lines = lines

        # Đảo ngược danh sách để log mới nhất lên đầu
        filtered_lines.reverse()
        
        total_logs = len(filtered_lines)
        total_pages = math.ceil(total_logs / limit)
        
        # Phân trang
        start_index = (page - 1) * limit
        end_index = start_index + limit
        paginated_lines = filtered_lines[start_index:end_index]

        for line in paginated_lines:
            match = log_pattern.match(line)
            if match:
                timestamp, level, component, message = match.groups()
                parsed_logs.append({
                    'timestamp': timestamp.strip(),
                    'level': level.strip(),
                    'component': component.strip(),
                    'message': message.strip()
                })
            elif line.strip():
                parsed_logs.append({
                    'timestamp': 'N/A',
                    'level': 'RAW',
                    'component': 'System',
                    'message': line.strip()
                })

        return jsonify({
            "logs": parsed_logs,
            "pagination": {
                "page": page,
                "limit": limit,
                "total_logs": total_logs,
                "total_pages": total_pages
            }
        })

    except FileNotFoundError:
        return jsonify({"error": "Log file not found."}), 404
    except Exception as e:
        return jsonify({"error": f"Could not read or parse log file: {str(e)}"}), 500

@app.route('/download-log')
@admin_required
def download_log():
    """
    API cho phép admin tải về toàn bộ file log.
    """
    try:
        # PROJECT_ROOT đã được định nghĩa ở phần cấu hình
        return send_from_directory(PROJECT_ROOT, 'gateway.log', as_attachment=True)
    except FileNotFoundError:
        return "Log file not found.", 404

@app.route('/run-node', methods=['POST'])
@admin_required  # <-- CH? ADMIN M?I C� QUY?N
def run_node():
    try:
        data = request.json
        sensor_id = data.get('sensor_id')
        sleep_time = data.get('sleep_time', 2)
        port = data.get('port', 12345)
        ip = data.get('ip', '127.0.0.1')
        node_exe = os.path.join(BASE_DIR, 'bin', 'sensor_node')
        subprocess.Popen([node_exe, str(sensor_id), str(sleep_time), ip, str(port)])
        return jsonify({"status": "started"})
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route('/room-sensors-map')
@login_required
def room_sensors_map():
    mapping = load_sensor_room_type_map()
    return jsonify(mapping)

@app.route('/rooms')
@login_required
def rooms():
    mapping = load_sensor_room_type_map()
    rooms = sorted(set([info['room_id'] for info in mapping.values()]))
    return jsonify(rooms)

# ============================================================================
# 6. PH?C V? FILE TINH (HTML, CSS, JS)
# ============================================================================

@app.route('/')
def root():
    # Trang g?c lu�n l� trang dang nh?p
    return send_from_directory(WEB_DIR, 'login.html')

# Flask s? t? d?ng ph?c v? c�c file kh�c trong thu m?c static_folder (WEB_DIR)
# V� d?: /index.html, /admin.html, /css/style.css s? du?c t? d?ng t�m th?y.
# Kh�ng c?n th�m route cho ch�ng.

# ============================================================================
# 7. KH?I CH?Y SERVER
# ============================================================================

import os # Thêm thư viện os
from pyngrok import ngrok
from flask import g

# ... (toàn bộ code ứng dụng Flask của bạn ở trên) ...

# Biến toàn cục để lưu URL của ngrok
ngrok_url = ""

@app.before_request
def store_ngrok_url():
    g.ngrok_url = ngrok_url

if __name__ == '__main__':
    # --- Đọc authtoken từ biến môi trường ---
    authtoken = os.getenv("NGROK_AUTHTOKEN")
    if authtoken:
        ngrok.set_auth_token(authtoken)
    else:
        print(" * Cảnh báo: Biến môi trường NGROK_AUTHTOKEN chưa được thiết lập. Tunnel có thể bị giới hạn thời gian.")
    # ------------------------------------------

    # Mở một tunnel ngrok tới port 5000
    tunnel = ngrok.connect(5000, "http")
    ngrok_url = tunnel.public_url
    
    print(" * Ngrok tunnel is active at:", ngrok_url)

    # Chạy ứng dụng Flask
    app.run(debug=True, host='0.0.0.0', port=5000, use_reloader=False)
