#!/usr/bin/env python3
"""
Garmin Connect Sync Script
Fetches activities, sleep, stress data and saves to Vercel Postgres
"""

import os
import json
from datetime import datetime, timedelta
from garminconnect import Garmin
import psycopg2
from psycopg2.extras import execute_values

# Configuration from environment
GARMIN_EMAIL = os.environ.get('GARMIN_EMAIL')
GARMIN_PASSWORD = os.environ.get('GARMIN_PASSWORD')
DATABASE_URL = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL')

def get_garmin_client():
    """Initialize and login to Garmin Connect"""
    print("🔐 Logging into Garmin Connect...")
    client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
    client.login()
    print("✅ Login successful!")
    return client

def get_db_connection():
    """Get PostgreSQL connection"""
    # Vercel Postgres URLs start with postgres:// but psycopg2 needs postgresql://
    db_url = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
    return psycopg2.connect(db_url)

def sync_activities(client, conn, days=30):
    """Sync running activities from Garmin"""
    print(f"\n🏃 Fetching activities (last {days} days)...")
    
    activities = client.get_activities(0, 100)  # Last 100 activities
    
    cursor = conn.cursor()
    count = 0
    
    for act in activities:
        if act.get('activityType', {}).get('typeKey') == 'running':
            try:
                activity_id = act['activityId']
                name = act.get('activityName', 'Run')
                distance = round(act.get('distance', 0) / 1000, 2)
                duration = int(act.get('duration', 0))
                
                # Calculate pace
                if distance > 0:
                    pace_sec = duration / distance
                    pace = f"{int(pace_sec // 60)}:{int(pace_sec % 60):02d}/km"
                else:
                    pace = "0:00/km"
                
                # Get date
                start_time = act.get('startTimeLocal', act.get('startTimeGMT', ''))
                if 'T' in start_time:
                    date = start_time.split('T')[0]
                else:
                    date = start_time.split(' ')[0]
                
                calories = int(act.get('calories', 0))
                elevation = int(act.get('elevationGain', 0))
                avg_hr = int(act.get('averageHR', 0))
                max_hr = int(act.get('maxHR', 0))
                
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
    print(f"✅ Synced {count} running activities")
    return count

def sync_sleep(client, conn, days=14):
    """Sync sleep data from Garmin"""
    print(f"\n😴 Fetching sleep data (last {days} days)...")
    
    cursor = conn.cursor()
    count = 0
    today = datetime.now()
    
    for i in range(days):
        date = (today - timedelta(days=i)).strftime('%Y-%m-%d')
        try:
            sleep = client.get_sleep_data(date)
            
            if sleep and 'dailySleepDTO' in sleep:
                s = sleep['dailySleepDTO']
                
                total_sleep = s.get('sleepTimeSeconds', 0)
                deep_sleep = s.get('deepSleepSeconds', 0)
                light_sleep = s.get('lightSleepSeconds', 0)
                rem_sleep = s.get('remSleepSeconds', 0)
                awake = s.get('awakeSleepSeconds', 0)
                
                # Get sleep score
                score = 0
                if 'sleepScores' in s and s['sleepScores']:
                    score = s['sleepScores'].get('overall', {}).get('value', 0) or 0
                
                cursor.execute("""
                    INSERT INTO sleep (date, total_sleep, deep_sleep, light_sleep, rem_sleep, awake, score, raw_data)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (date) DO UPDATE SET
                        total_sleep = EXCLUDED.total_sleep, deep_sleep = EXCLUDED.deep_sleep,
                        light_sleep = EXCLUDED.light_sleep, rem_sleep = EXCLUDED.rem_sleep,
                        awake = EXCLUDED.awake, score = EXCLUDED.score, raw_data = EXCLUDED.raw_data
                """, (date, total_sleep, deep_sleep, light_sleep, rem_sleep, awake, score, json.dumps(sleep)))
                
                count += 1
        except Exception as e:
            pass  # Skip days with no data
    
    conn.commit()
    print(f"✅ Synced {count} days of sleep data")
    return count

def sync_stress(client, conn, days=14):
    """Sync stress data from Garmin"""
    print(f"\n😰 Fetching stress data (last {days} days)...")
    
    cursor = conn.cursor()
    count = 0
    today = datetime.now()
    
    for i in range(days):
        date = (today - timedelta(days=i)).strftime('%Y-%m-%d')
        try:
            stress = client.get_stress_data(date)
            
            if stress:
                avg_stress = stress.get('avgStressLevel', 0) or 0
                max_stress = stress.get('maxStressLevel', 0) or 0
                
                cursor.execute("""
                    INSERT INTO stress (date, avg_stress, max_stress, raw_data)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (date) DO UPDATE SET
                        avg_stress = EXCLUDED.avg_stress, max_stress = EXCLUDED.max_stress, raw_data = EXCLUDED.raw_data
                """, (date, avg_stress, max_stress, json.dumps(stress)))
                
                count += 1
        except Exception as e:
            pass  # Skip days with no data
    
    conn.commit()
    print(f"✅ Synced {count} days of stress data")
    return count

def main():
    print("=" * 50)
    print("🏃 Garmin Connect Sync")
    print("=" * 50)
    
    # Validate environment
    if not GARMIN_EMAIL or not GARMIN_PASSWORD:
        print("❌ Error: GARMIN_EMAIL and GARMIN_PASSWORD must be set")
        exit(1)
    
    if not DATABASE_URL:
        print("❌ Error: DATABASE_URL must be set")
        exit(1)
    
    try:
        # Connect to Garmin
        client = get_garmin_client()
        
        # Connect to database
        print("\n📊 Connecting to database...")
        conn = get_db_connection()
        print("✅ Database connected!")
        
        # Sync all data
        activities = sync_activities(client, conn)
        sleep = sync_sleep(client, conn)
        stress = sync_stress(client, conn)
        
        # Close connection
        conn.close()
        
        print("\n" + "=" * 50)
        print("✅ Sync completed!")
        print(f"   Activities: {activities}")
        print(f"   Sleep days: {sleep}")
        print(f"   Stress days: {stress}")
        print("=" * 50)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        exit(1)

if __name__ == "__main__":
    main()
