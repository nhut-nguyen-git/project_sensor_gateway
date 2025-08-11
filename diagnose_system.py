# -*- coding: utf-8 -*-
import os
import sqlite3
import requests

ROOM_SENSOR_FILE = "room_sensor.map"
TYPE_FILE = "type.map"
DB_FILE = "Sensor.db"
API_BASE = "http://localhost:5000"

def load_room_sensor_map():
    mapping = {}
    with open(ROOM_SENSOR_FILE, 'r') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) == 2:
                room, sensor = int(parts[0]), int(parts[1])
                mapping[sensor] = room
    return mapping

def load_type_map():
    mapping = {}
    with open(TYPE_FILE, 'r') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) == 2:
                sensor, sensor_type = int(parts[0]), parts[1]
                mapping[sensor] = sensor_type
    return mapping

def check_db_for_sensor(sensor_id):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM SensorData WHERE sensor_id = ?", (sensor_id,))
    count = cur.fetchone()[0]
    conn.close()
    return count

def check_api(sensor_id):
    try:
        res = requests.get(f"{API_BASE}/sensor/{sensor_id}/history", timeout=2)
        if res.status_code == 200:
            data = res.json()
            return len(data)
        return -1
    except Exception as e:
        return -2

def main():
    print("?? DANG KIEM TEA...")

    room_map = load_room_sensor_map()
    type_map = load_type_map()

    all_sensors = set(room_map.keys()) | set(type_map.keys())

    for sensor_id in sorted(all_sensors):
        status = []
        room = room_map.get(sensor_id)
        typ = type_map.get(sensor_id)

        if room is None:
            status.append("?? THIEU room_id")
        if typ is None:
            status.append("?? THIEU type")

        db_count = check_db_for_sensor(sensor_id)
        if db_count == 0:
            status.append("? KHONG CO DU LIEU trong DB")
        else:
            status.append(f"? {db_count} BAN GHI ghi trong DB")

        api_count = check_api(sensor_id)
        if api_count == -2:
            status.append("? KO CONNET API")
        elif api_count == -1:
            status.append("? API LOI")
        elif api_count == 0:
            status.append("? API TRA VE RONG")
        else:
            status.append(f"? API tra {api_count} ban ghi")

        print(f"Sensor {sensor_id:>3} | Room: {room} | Type: {typ or 'N/A'} ? " + " | ".join(status))

if __name__ == "__main__":
    main()