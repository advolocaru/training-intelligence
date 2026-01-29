import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const source = req.query.source; // 'garmin', 'strava', or undefined for all
    const limit = parseInt(req.query.limit) || 200;
    
    let result;
    if (source) {
      result = await sql`
        SELECT id, source, name, activity_type, date, distance, duration, pace, 
               calories, elevation, avg_hr, max_hr, coords
        FROM activities 
        WHERE activity_type = 'run' AND source = ${source}
        ORDER BY date DESC 
        LIMIT ${limit}
      `;
    } else {
      result = await sql`
        SELECT id, source, name, activity_type, date, distance, duration, pace, 
               calories, elevation, avg_hr, max_hr, coords
        FROM activities 
        WHERE activity_type = 'run'
        ORDER BY date DESC 
        LIMIT ${limit}
      `;
    }

    return res.status(200).json({ 
      success: true, 
      count: result.rows.length,
      activities: result.rows 
    });

  } catch (error) {
    console.error('Error fetching activities:', error);
    return res.status(500).json({ error: error.message });
  }
}
