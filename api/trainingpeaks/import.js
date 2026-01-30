const { sql } = require('@vercel/postgres');
const crypto = require('crypto');

// Helper functions
function generateTpId(dateStr, workoutType, distance) {
  const uniqueString = `tp_${dateStr}_${workoutType}_${distance || 0}`;
  const hash = crypto.createHash('md5').update(uniqueString).digest('hex');
  return BigInt('0x' + hash.substring(0, 15)).toString();
}

function parseFloatSafe(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

function parseIntSafe(value) {
  const f = parseFloatSafe(value);
  return f !== null ? Math.round(f) : null;
}

function hoursToSeconds(hours) {
  if (hours === null) return null;
  return Math.round(hours * 3600);
}

function velocityToPace(velocityMps, workoutType) {
  if (!velocityMps || velocityMps <= 0) return null;
  
  if (['run', 'walk'].includes(workoutType?.toLowerCase())) {
    const paceSecondsPerKm = 1000 / velocityMps;
    const minutes = Math.floor(paceSecondsPerKm / 60);
    const seconds = Math.round(paceSecondsPerKm % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
  } else {
    const kmh = velocityMps * 3.6;
    return `${kmh.toFixed(1)} km/h`;
  }
}

function mapWorkoutType(tpType) {
  const mapping = {
    'run': 'Run',
    'bike': 'Ride', 
    'walk': 'Walk',
    'mtb': 'Ride',
    'strength': 'Workout',
    'other': 'Workout',
    'swim': 'Swim',
  };
  return mapping[tpType?.toLowerCase()] || 'Workout';
}

function parseMetricValue(valueStr) {
  if (!valueStr || valueStr === '') return { min: null, max: null, avg: null };
  
  valueStr = String(valueStr).trim();
  
  if (valueStr.includes('/') && valueStr.includes(':')) {
    const parts = {};
    valueStr.split('/').forEach(part => {
      part = part.trim();
      if (part.includes(':')) {
        const [key, val] = part.split(':');
        parts[key.trim().toLowerCase()] = parseFloatSafe(val.trim());
      }
    });
    return { min: parts.min || null, max: parts.max || null, avg: parts.avg || null };
  }
  
  return { min: null, max: null, avg: parseFloatSafe(valueStr) };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { workouts, metrics } = req.body;
  
  if (!workouts && !metrics) {
    return res.status(400).json({ error: 'No data provided. Send workouts and/or metrics arrays.' });
  }

  const results = {
    workouts: { inserted: 0, updated: 0, errors: [] },
    metrics: { sleep: 0, stress: 0, errors: [] }
  };

  try {
    // Import workouts
    if (workouts && Array.isArray(workouts)) {
      for (const row of workouts) {
        try {
          // Skip if no actual workout data
          if (!row.DistanceInMeters && !row.TimeTotalInHours) continue;
          
          const activityId = generateTpId(row.WorkoutDay, row.WorkoutType, row.DistanceInMeters);
          const distance = parseFloatSafe(row.DistanceInMeters);
          const duration = hoursToSeconds(parseFloatSafe(row.TimeTotalInHours));
          const avgVelocity = parseFloatSafe(row.VelocityAverage);
          const workoutType = row.WorkoutType || 'Other';
          const pace = velocityToPace(avgVelocity, workoutType);
          
          const energyKj = parseFloatSafe(row.Energy);
          const calories = energyKj ? Math.round(energyKj / 4.184) : null;
          
          const rawData = {
            source: 'trainingpeaks',
            title: row.Title,
            workout_type: workoutType,
            description: row.WorkoutDescription,
            planned_duration: parseFloatSafe(row.PlannedDuration),
            planned_distance: parseFloatSafe(row.PlannedDistanceInMeters),
            power_avg: parseIntSafe(row.PowerAverage),
            power_max: parseIntSafe(row.PowerMax),
            energy_kj: energyKj,
            cadence_avg: parseIntSafe(row.CadenceAverage),
            cadence_max: parseIntSafe(row.CadenceMax),
            velocity_avg: avgVelocity,
            velocity_max: parseFloatSafe(row.VelocityMax),
            tss: parseFloatSafe(row.TSS),
            intensity_factor: parseFloatSafe(row.IF),
            rpe: parseIntSafe(row.Rpe),
            feeling: parseIntSafe(row.Feeling),
            hr_zones: {
              z1: parseFloatSafe(row.HRZone1Minutes),
              z2: parseFloatSafe(row.HRZone2Minutes),
              z3: parseFloatSafe(row.HRZone3Minutes),
              z4: parseFloatSafe(row.HRZone4Minutes),
              z5: parseFloatSafe(row.HRZone5Minutes),
              z6: parseFloatSafe(row.HRZone6Minutes),
              z7: parseFloatSafe(row.HRZone7Minutes),
            }
          };

          const name = row.Title || `${workoutType} - ${row.WorkoutDay}`;
          
          await sql`
            INSERT INTO activities (id, source, name, activity_type, date, distance, duration, pace, calories, avg_hr, max_hr, raw_data, created_at, updated_at)
            VALUES (${activityId}, 'trainingpeaks', ${name}, ${mapWorkoutType(workoutType)}, ${row.WorkoutDay}, ${distance}, ${duration}, ${pace}, ${calories}, ${parseIntSafe(row.HeartRateAverage)}, ${parseIntSafe(row.HeartRateMax)}, ${JSON.stringify(rawData)}, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              activity_type = EXCLUDED.activity_type,
              distance = EXCLUDED.distance,
              duration = EXCLUDED.duration,
              pace = EXCLUDED.pace,
              calories = EXCLUDED.calories,
              avg_hr = EXCLUDED.avg_hr,
              max_hr = EXCLUDED.max_hr,
              raw_data = EXCLUDED.raw_data,
              updated_at = NOW()
          `;
          
          results.workouts.inserted++;
        } catch (err) {
          results.workouts.errors.push({ row: row.WorkoutDay, error: err.message });
        }
      }
    }

    // Import metrics
    if (metrics && Array.isArray(metrics)) {
      // Group by date
      const byDate = {};
      for (const row of metrics) {
        const date = row.Timestamp?.split(' ')[0];
        if (!date) continue;
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(row);
      }

      for (const [date, rows] of Object.entries(byDate)) {
        const m = {
          sleep_hours: null,
          deep_sleep: null,
          light_sleep: null,
          rem_sleep: null,
          awake: null,
          hrv: null,
          resting_hr: null,
          stress_avg: null,
          stress_max: null,
          body_battery_min: null,
          body_battery_max: null,
          weight: null
        };

        for (const row of rows) {
          const { min, max, avg } = parseMetricValue(row.Value);
          
          switch (row.Type) {
            case 'Sleep Hours': m.sleep_hours = avg; break;
            case 'Time In Deep Sleep': m.deep_sleep = avg; break;
            case 'Time In Light Sleep': m.light_sleep = avg; break;
            case 'Time In REM Sleep': m.rem_sleep = avg; break;
            case 'Time Awake': m.awake = avg; break;
            case 'HRV': m.hrv = avg; break;
            case 'Pulse': m.resting_hr = avg; break;
            case 'Stress Level': m.stress_avg = avg; m.stress_max = max; break;
            case 'Body Battery': m.body_battery_min = min; m.body_battery_max = max; break;
            case 'Weight Kilograms': m.weight = avg; break;
          }
        }

        try {
          // Insert sleep
          if (m.sleep_hours !== null) {
            const totalSleepMin = Math.round(m.sleep_hours * 60);
            await sql`
              INSERT INTO sleep (date, total_sleep, deep_sleep, light_sleep, rem_sleep, awake, raw_data, created_at)
              VALUES (${date}, ${totalSleepMin}, ${parseIntSafe(m.deep_sleep)}, ${parseIntSafe(m.light_sleep)}, ${parseIntSafe(m.rem_sleep)}, ${parseIntSafe(m.awake)}, ${JSON.stringify({ source: 'trainingpeaks', hrv: m.hrv, resting_hr: m.resting_hr, body_battery_min: m.body_battery_min, body_battery_max: m.body_battery_max, weight: m.weight })}, NOW())
              ON CONFLICT (date) DO UPDATE SET
                total_sleep = EXCLUDED.total_sleep,
                deep_sleep = EXCLUDED.deep_sleep,
                light_sleep = EXCLUDED.light_sleep,
                rem_sleep = EXCLUDED.rem_sleep,
                awake = EXCLUDED.awake,
                raw_data = EXCLUDED.raw_data
            `;
            results.metrics.sleep++;
          }

          // Insert stress
          if (m.stress_avg !== null) {
            await sql`
              INSERT INTO stress (date, avg_stress, max_stress, raw_data, created_at)
              VALUES (${date}, ${parseIntSafe(m.stress_avg)}, ${parseIntSafe(m.stress_max)}, ${JSON.stringify({ source: 'trainingpeaks' })}, NOW())
              ON CONFLICT (date) DO UPDATE SET
                avg_stress = EXCLUDED.avg_stress,
                max_stress = EXCLUDED.max_stress,
                raw_data = EXCLUDED.raw_data
            `;
            results.metrics.stress++;
          }
        } catch (err) {
          results.metrics.errors.push({ date, error: err.message });
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'TrainingPeaks data imported successfully',
      results
    });

  } catch (error) {
    console.error('Import error:', error);
    return res.status(500).json({ error: error.message, results });
  }
};
