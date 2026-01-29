import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const days = parseInt(req.query.days) || 30;
    
    const { rows } = await sql`
      SELECT date, avg_stress, max_stress
      FROM stress 
      ORDER BY date DESC 
      LIMIT ${days}
    `;

    return res.status(200).json({ 
      success: true, 
      count: rows.length,
      stress: rows 
    });

  } catch (error) {
    console.error('Error fetching stress:', error);
    return res.status(500).json({ error: error.message });
  }
}
