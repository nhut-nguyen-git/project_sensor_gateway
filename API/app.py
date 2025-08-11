# -*- coding: utf-8 -*-
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import sqlite3
import os
import time
import subprocess

# Xác d?nh các du?ng d?n tuong d?i d?n web, database và log
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WEB_DIR = os.path.join(BASE_DIR, "web")
DB_FILE = os.path.join(BASE_DIR, "Sensor.db")
LOG_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), '../gateway.log'))

app = Flask(__name__, static_folder=WEB_DIR, static_url_path='')
CORS(app)


@app.route('/')
def index():
    return send_from_directory(WEB_DIR, 'index.html')


@app.route('/admin')
def admin():
    return send_from_directory(WEB_DIR, 'admin.html')

# API: get list sensor
@app.route('/sensors')
def get_sensors():
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT sensor_id FROM SensorData")
    data = [row[0] for row in cur.fetchall()]
    conn.close()
    return jsonify(data)

# API: GET Data last
@app.route('/sensor/<int:sensor_id>/latest')
def latest(sensor_id):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("""
        SELECT sensor_value, timestamp FROM SensorData
        WHERE sensor_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
    """, (sensor_id,))
    row = cur.fetchone()
    conn.close()
    if row:
      return jsonify({"sensor_value": row[0],"timestamp": row[1]})
    return jsonify({})
    
    

# API: get data in range
@app.route('/sensor/<int:sensor_id>/history')
def history(sensor_id):
    try:
        from_ts = int(request.args.get('from', 0))
        to_ts = int(request.args.get('to', int(time.time())))
    except:
        return jsonify([])

    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("""
        SELECT sensor_value AS value, timestamp 
        FROM SensorData 
        WHERE sensor_id = ? AND timestamp BETWEEN ? AND ? 
        ORDER BY timestamp ASC
    """, (sensor_id, from_ts, to_ts))
    rows = cur.fetchall()
    conn.close()
    return jsonify([{"value": row[0], "timestamp": row[1]} for row in rows])

# API: 
@app.route('/sensor/<int:sensor_id>/range')
def time_range(sensor_id):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("""
        SELECT MIN(timestamp), MAX(timestamp) 
        FROM SensorData 
        WHERE sensor_id = ?
    """, (sensor_id,))
    row = cur.fetchone()
    conn.close()
    if row and row[0] is not None:
        return jsonify({"start": row[0], "end": row[1]})
    return jsonify({})


@app.route('/log')
def view_log():
    try:
        with open(LOG_FILE, 'r') as f:
            content = f.read()
        return jsonify({"log": content})
    except Exception as e:
        print("LOG READ ERROR:", str(e))  # In l?i rõ ràng ra console
        return jsonify({"error": f"Could not read log file: {str(e)}"})


@app.route('/run-node', methods=['POST'])
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

SENSOR_MAP_FILE = os.path.join(BASE_DIR, 'room_sensor.map')
TYPE_MAP_FILE = os.path.join(BASE_DIR, 'type.map')

def load_sensor_room_type_map():
    room_map = {}
    type_map = {}
    combined = {}

    if os.path.exists(SENSOR_MAP_FILE):
        with open(SENSOR_MAP_FILE) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) != 2:
                    continue
                room_id, sensor_id = int(parts[0]), int(parts[1])
                room_map[sensor_id] = room_id

    if os.path.exists(TYPE_MAP_FILE):
        with open(TYPE_MAP_FILE) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) != 2:
                    continue
                sensor_id, sensor_type = int(parts[0]), parts[1]
                type_map[sensor_id] = sensor_type

    for sensor_id in set(room_map.keys()) & set(type_map.keys()):
        combined[sensor_id] = {
            'room_id': room_map[sensor_id],
            'type': type_map[sensor_id]
        }
    return combined

@app.route('/room-sensors-map')
def room_sensors_map():
    mapping = load_sensor_room_type_map()
    return jsonify(mapping)

@app.route('/rooms')
def rooms():
    mapping = load_sensor_room_type_map()
    rooms = sorted(set([info['room_id'] for info in mapping.values()]))
    return jsonify(rooms)


if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)