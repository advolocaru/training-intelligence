import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { rows } = await sql`
      SELECT id, source, name, activity_type, date, distance, duration, pace, 
             calories, elevation, avg_hr, max_hr, coords
      FROM activities 
      WHERE activity_type = 'run'
      ORDER BY date DESC 
      LIMIT 200
    `;

    return res.status(200).json({ 
      success: true, 
      count: rows.length,
      activities: rows 
    });

  } catch (error) {
    console.error('Error fetching activities:', error);
    return res.status(500).json({ error: error.message });
  }
}
