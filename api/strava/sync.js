import { sql } from '@vercel/postgres';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    // Get fresh access token
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        refresh_token: process.env.STRAVA_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      })
    });

    if (!tokenRes.ok) throw new Error('Token refresh failed');
    const tokenData = await tokenRes.json();

    // Fetch all activities with pagination
    let allActivities = [];
    let page = 1;
    
    while (true) {
      const activitiesRes = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`,
        { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } }
      );
      
      if (!activitiesRes.ok) throw new Error('Failed to fetch activities');
      const activities = await activitiesRes.json();
      
      if (!Array.isArray(activities) || activities.length === 0) break;
      allActivities = allActivities.concat(activities);
      if (activities.length < 200) break;
      page++;
    }

    // Filter runs and insert into DB
    let count = 0;
    for (const act of allActivities) {
      if (act.type === 'Run') {
        const distance = (act.distance / 1000).toFixed(2);
        const duration = act.moving_time;
        const paceSeconds = act.moving_time / (act.distance / 1000);
        const pace = `${Math.floor(paceSeconds / 60)}:${Math.round(paceSeconds % 60).toString().padStart(2, '0')}/km`;
        const date = act.start_date_local.split('T')[0];

        await sql`
          INSERT INTO activities (id, source, name, activity_type, date, distance, duration, pace, calories, elevation, avg_hr, max_hr, coords, raw_data)
          VALUES (${act.id}, 'strava', ${act.name}, 'run', ${date}, ${distance}, ${duration}, ${pace}, ${Math.round(act.kilojoules || 0)}, ${Math.round(act.total_elevation_gain || 0)}, ${act.average_heartrate || 0}, ${act.max_heartrate || 0}, ${act.map?.summary_polyline || ''}, ${JSON.stringify(act)})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, distance = EXCLUDED.distance, duration = EXCLUDED.duration,
            pace = EXCLUDED.pace, calories = EXCLUDED.calories, elevation = EXCLUDED.elevation,
            avg_hr = EXCLUDED.avg_hr, max_hr = EXCLUDED.max_hr, coords = EXCLUDED.coords,
            raw_data = EXCLUDED.raw_data, updated_at = NOW()
        `;
        count++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Synced ${count} runs from Strava`,
      total: count
    });

  } catch (error) {
    console.error('Strava sync error:', error);
    return res.status(500).json({ error: 'Sync failed', message: error.message });
  }
}
