# -*- coding: utf-8 -*-
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import sqlite3
import os
import time

app = Flask(__name__, static_folder='../web', static_url_path='')
CORS(app)  # Allow access from other devices

DB_FILE = 'Sensor.db'

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/sensors')
def sensors():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT sensor_id FROM SensorData")
    ids = [row['sensor_id'] for row in cur.fetchall()]
    conn.close()
    return jsonify(ids)

@app.route('/sensor/<int:sensor_id>/latest')
def latest(sensor_id):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT sensor_value, timestamp FROM SensorData
        WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 1
    """, (sensor_id,))
    row = cur.fetchone()
    conn.close()
    if row:
        return jsonify({"sensor_value": row['sensor_value'], "timestamp": row['timestamp']})
    return jsonify({})

@app.route('/sensor/<int:sensor_id>/history')
def history(sensor_id):
    try:
        from_ts = request.args.get('from')
        to_ts = request.args.get('to')
        if from_ts and to_ts:
            from_ts = int(from_ts)
            to_ts = int(to_ts)
        else:
            to_ts = int(time.time())
            from_ts = to_ts - 60 * 10  # default: last 10 minutes
    except:
        return jsonify([])

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT sensor_value AS value, timestamp FROM SensorData
        WHERE sensor_id = ? AND timestamp BETWEEN ? AND ?
        ORDER BY timestamp ASC
    """, (sensor_id, from_ts, to_ts))
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])

@app.route('/sensor/<int:sensor_id>/range')
def time_range(sensor_id):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT MIN(timestamp) as start_ts, MAX(timestamp) as end_ts FROM SensorData
        WHERE sensor_id = ?
    """, (sensor_id,))
    row = cur.fetchone()
    conn.close()
    if row['start_ts'] is not None and row['end_ts'] is not None:
        return jsonify({"start": row['start_ts'], "end": row['end_ts']})
    return jsonify({})

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)
