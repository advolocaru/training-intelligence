const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const days = parseInt(req.query.days) || 14;
    
    // Get sleep data
    const sleepResult = await sql`
      SELECT date, total_sleep, deep_sleep, light_sleep, rem_sleep, awake, score
      FROM sleep ORDER BY date DESC LIMIT ${days}
    `;
    
    // Get stress data
    const stressResult = await sql`
      SELECT date, avg_stress, max_stress
      FROM stress ORDER BY date DESC LIMIT ${days}
    `;

    // Format sleep data (convert seconds to hours)
    const sleep = sleepResult.rows.map(r => ({
      date: r.date,
      totalHours: (r.total_sleep / 3600).toFixed(1),
      deepHours: (r.deep_sleep / 3600).toFixed(1),
      lightHours: (r.light_sleep / 3600).toFixed(1),
      remHours: (r.rem_sleep / 3600).toFixed(1),
      score: r.score
    }));

    return res.status(200).json({ 
      success: true,
      sleep: sleep,
      stress: stressResult.rows
    });

  } catch (error) {
    console.error('Error fetching health data:', error);
    return res.status(500).json({ error: error.message });
  }
};
