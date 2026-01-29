#!/usr/bin/env python3
"""
Garmin Connect Sync Script
Uses saved OAuth tokens to fetch activities, sleep, stress data
"""

import os
import json
from datetime import datetime, timedelta
import garth
from garth import SleepData, DailyStress
from garth.exc import GarthHTTPError
import psycopg2

# Configuration from environment
DATABASE_URL = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL')
OAUTH1_TOKEN = os.environ.get('GARMIN_OAUTH1_TOKEN')
OAUTH2_TOKEN = os.environ.get('GARMIN_OAUTH2_TOKEN')

def setup_garth():
    """Setup garth with saved tokens"""
    print("🔐 Loading Garmin tokens...")
    
    tokens_dir = '/tmp/garth_tokens'
    os.makedirs(tokens_dir, exist_ok=True)
    
    with open(os.path.join(tokens_dir, 'oauth1_token.json'), 'w') as f:
        f.write(OAUTH1_TOKEN)
    with open(os.path.join(tokens_dir, 'oauth2_token.json'), 'w') as f:
        f.write(OAUTH2_TOKEN)
    
    garth.resume(tokens_dir)
    print("✅ Garmin tokens loaded successfully!")

def get_db_connection():
    """Get PostgreSQL connection"""
    db_url = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
    return psycopg2.connect(db_url)

def sync_activities(conn, days=30):
    """Sync running activities from Garmin"""
    print(f"\n🏃 Fetching activities...")
    
    cursor = conn.cursor()
    count = 0
    
    try:
        activities = garth.connectapi("/activitylist-service/activities/search/activities", params={"limit": 100})
        
        for act in activities:
            if act.get('activityType', {}).get('typeKey') == 'running':
                try:
                    activity_id = act['activityId']
                    name = act.get('activityName', 'Run')
                    distance = round(act.get('distance', 0) / 1000, 2)
                    duration = int(act.get('duration', 0))
                    
                    if distance > 0:
                        pace_sec = duration / distance
                        pace = f"{int(pace_sec // 60)}:{int(pace_sec % 60):02d}/km"
                    else:
                        pace = "0:00/km"
                    
                    start_time = act.get('startTimeLocal', act.get('startTimeGMT', ''))
                    if 'T' in str(start_time):
                        date = str(start_time).split('T')[0]
                    else:
                        date = str(start_time).split(' ')[0]
                    
                    calories = int(act.get('calories', 0) or 0)
                    elevation = int(act.get('elevationGain', 0) or 0)
                    avg_hr = int(act.get('averageHR', 0) or 0)
                    max_hr = int(act.get('maxHR', 0) or 0)
                    
                    cursor.execute("""
                        INSERT INTO activities (id, source, name, activity_type, date, distance, duration, pace, calories, elevation, avg_hr, max_hr)
                        VALUES (%s, 'garmin', %s, 'run', %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name, distance = EXCLUDED.distance, duration = EXCLUDED.duration,
                            pace = EXCLUDED.pace, calories = EXCLUDED.calories, elevation = EXCLUDED.elevation,
                            avg_hr = EXCLUDED.avg_hr, max_hr = EXCLUDED.max_hr, updated_at = NOW()
                    """, (activity_id, name, date, distance, duration, pace, calories, elevation, avg_hr, max_hr))
                    
                    count += 1
                except Exception as e:
                    print(f"  ⚠️ Error processing activity: {e}")
        
        conn.commit()
    except GarthHTTPError as e:
        print(f"  ⚠️ API Error: {e}")
    
    print(f"✅ Synced {count} running activities")
    return count

def sync_sleep(conn, days=14):
    """Sync sleep data from Garmin using SleepData.list()"""
    print(f"\n😴 Fetching sleep data (last {days} days)...")
    
    cursor = conn.cursor()
    count = 0
    
    try:
        end_date = datetime.now().strftime('%Y-%m-%d')
        sleep_list = SleepData.list(end_date, days)
        
        for sleep in sleep_list:
            try:
                s = sleep.daily_sleep_dto
                date = s.calendar_date.strftime('%Y-%m-%d')
                
                total_sleep = s.sleep_time_seconds or 0
                deep_sleep = s.deep_sleep_seconds or 0
                light_sleep = s.light_sleep_seconds or 0
                rem_sleep = s.rem_sleep_seconds or 0
                awake = s.awake_sleep_seconds or 0
                score = 0  # Sleep score not always available
                
                cursor.execute("""
                    INSERT INTO sleep (date, total_sleep, deep_sleep, light_sleep, rem_sleep, awake, score)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (date) DO UPDATE SET
                        total_sleep = EXCLUDED.total_sleep, deep_sleep = EXCLUDED.deep_sleep,
                        light_sleep = EXCLUDED.light_sleep, rem_sleep = EXCLUDED.rem_sleep,
                        awake = EXCLUDED.awake, score = EXCLUDED.score
                """, (date, total_sleep, deep_sleep, light_sleep, rem_sleep, awake, score))
                
                count += 1
            except Exception as e:
                print(f"  ⚠️ Error processing sleep: {e}")
        
        conn.commit()
    except Exception as e:
        print(f"  ⚠️ Sleep error: {e}")
    
    print(f"✅ Synced {count} days of sleep data")
    return count

def sync_stress(conn, days=14):
    """Sync stress data from Garmin"""
    print(f"\n😰 Fetching stress data (last {days} days)...")
    
    cursor = conn.cursor()
    count = 0
    
    try:
        end_date = datetime.now().strftime('%Y-%m-%d')
        stress_list = DailyStress.list(end_date, days)
        
        for stress in stress_list:
            try:
                date = stress.calendar_date.strftime('%Y-%m-%d')
                avg_stress = stress.avg_stress_level or 0
                max_stress = stress.max_stress_level or 0
                
                cursor.execute("""
                    INSERT INTO stress (date, avg_stress, max_stress)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (date) DO UPDATE SET
                        avg_stress = EXCLUDED.avg_stress, max_stress = EXCLUDED.max_stress
                """, (date, avg_stress, max_stress))
                
                count += 1
            except Exception as e:
                print(f"  ⚠️ Error processing stress: {e}")
        
        conn.commit()
    except Exception as e:
        print(f"  ⚠️ Stress error: {e}")
    
    print(f"✅ Synced {count} days of stress data")
    return count

def main():
    print("=" * 50)
    print("🏃 Garmin Connect Sync")
    print("=" * 50)
    
    if not OAUTH1_TOKEN or not OAUTH2_TOKEN:
        print("❌ Error: GARMIN_OAUTH1_TOKEN and GARMIN_OAUTH2_TOKEN must be set")
        exit(1)
    
    if not DATABASE_URL:
        print("❌ Error: DATABASE_URL must be set")
        exit(1)
    
    try:
        setup_garth()
        
        print("\n📊 Connecting to database...")
        conn = get_db_connection()
        print("✅ Database connected!")
        
        activities = sync_activities(conn)
        sleep = sync_sleep(conn)
        stress = sync_stress(conn)
        
        conn.close()
        
        print("\n" + "=" * 50)
        print("✅ Sync completed!")
        print(f"   Activities: {activities}")
        print(f"   Sleep days: {sleep}")
        print(f"   Stress days: {stress}")
        print("=" * 50)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        exit(1)

if __name__ == "__main__":
    main()
