import { sql } from '@vercel/postgres';
import GarminConnect from 'garmin-connect';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const GCClient = new GarminConnect({
    username: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
  });

  try {
    await GCClient.login();
    
    const results = { activities: 0, sleep: 0, stress: 0, errors: [] };

    // Get running activities
    try {
      const activities = await GCClient.getActivities(0, 100);
      
      for (const act of activities) {
        if (act.activityType?.typeKey === 'running') {
          const distance = (act.distance / 1000).toFixed(2);
          const duration = Math.round(act.duration);
          const paceSeconds = act.duration / (act.distance / 1000);
          const pace = `${Math.floor(paceSeconds / 60)}:${Math.round(paceSeconds % 60).toString().padStart(2, '0')}/km`;

          await sql`
            INSERT INTO activities (id, source, name, activity_type, date, distance, duration, pace, calories, elevation, avg_hr, max_hr, raw_data)
            VALUES (${act.activityId}, 'garmin', ${act.activityName}, 'run', ${act.startTimeLocal.split('T')[0]}, ${distance}, ${duration}, ${pace}, ${act.calories || 0}, ${Math.round(act.elevationGain || 0)}, ${act.averageHR || 0}, ${act.maxHR || 0}, ${JSON.stringify(act)})
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name, distance = EXCLUDED.distance, duration = EXCLUDED.duration,
              pace = EXCLUDED.pace, calories = EXCLUDED.calories, elevation = EXCLUDED.elevation,
              avg_hr = EXCLUDED.avg_hr, max_hr = EXCLUDED.max_hr, raw_data = EXCLUDED.raw_data, updated_at = NOW()
          `;
          results.activities++;
        }
      }
    } catch (e) {
      results.errors.push('Activities: ' + e.message);
    }

    // Get sleep data (last 14 days)
    try {
      const today = new Date();
      for (let i = 0; i < 14; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        try {
          const sleep = await GCClient.getSleepData(dateStr);
          if (sleep?.dailySleepDTO) {
            const s = sleep.dailySleepDTO;
            await sql`
              INSERT INTO sleep (date, total_sleep, deep_sleep, light_sleep, rem_sleep, awake, score, raw_data)
              VALUES (${dateStr}, ${s.sleepTimeSeconds || 0}, ${s.deepSleepSeconds || 0}, ${s.lightSleepSeconds || 0}, ${s.remSleepSeconds || 0}, ${s.awakeSleepSeconds || 0}, ${s.sleepScores?.overall?.value || 0}, ${JSON.stringify(sleep)})
              ON CONFLICT (date) DO UPDATE SET
                total_sleep = EXCLUDED.total_sleep, deep_sleep = EXCLUDED.deep_sleep, light_sleep = EXCLUDED.light_sleep,
                rem_sleep = EXCLUDED.rem_sleep, awake = EXCLUDED.awake, score = EXCLUDED.score, raw_data = EXCLUDED.raw_data
            `;
            results.sleep++;
          }
        } catch (e) { /* skip */ }
      }
    } catch (e) {
      results.errors.push('Sleep: ' + e.message);
    }

    // Get stress data (last 14 days)
    try {
      const today = new Date();
      for (let i = 0; i < 14; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        try {
          const stress = await GCClient.getDailyStress(dateStr);
          if (stress) {
            await sql`
              INSERT INTO stress (date, avg_stress, max_stress, raw_data)
              VALUES (${dateStr}, ${stress.avgStressLevel || 0}, ${stress.maxStressLevel || 0}, ${JSON.stringify(stress)})
              ON CONFLICT (date) DO UPDATE SET
                avg_stress = EXCLUDED.avg_stress, max_stress = EXCLUDED.max_stress, raw_data = EXCLUDED.raw_data
            `;
            results.stress++;
          }
        } catch (e) { /* skip */ }
      }
    } catch (e) {
      results.errors.push('Stress: ' + e.message);
    }

    return res.status(200).json({ success: true, message: 'Garmin sync completed', results });

  } catch (error) {
    console.error('Garmin sync error:', error);
    return res.status(500).json({ error: 'Sync failed', message: error.message });
  }
}
