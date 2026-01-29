import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const days = parseInt(req.query.days) || 30;
    
    const { rows } = await sql`
      SELECT date, total_sleep, deep_sleep, light_sleep, rem_sleep, awake, score
      FROM sleep 
      ORDER BY date DESC 
      LIMIT ${days}
    `;

    // Convert seconds to hours for readability
    const formatted = rows.map(r => ({
      date: r.date,
      totalHours: (r.total_sleep / 3600).toFixed(1),
      deepHours: (r.deep_sleep / 3600).toFixed(1),
      lightHours: (r.light_sleep / 3600).toFixed(1),
      remHours: (r.rem_sleep / 3600).toFixed(1),
      awakeHours: (r.awake / 3600).toFixed(1),
      score: r.score
    }));

    return res.status(200).json({ 
      success: true, 
      count: rows.length,
      sleep: formatted 
    });

  } catch (error) {
    console.error('Error fetching sleep:', error);
    return res.status(500).json({ error: error.message });
  }
}
