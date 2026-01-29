const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS activities (
        id BIGINT PRIMARY KEY,
        source VARCHAR(20) NOT NULL,
        name VARCHAR(255),
        activity_type VARCHAR(50),
        date DATE NOT NULL,
        distance DECIMAL(10,2),
        duration INTEGER,
        pace VARCHAR(20),
        calories INTEGER,
        elevation INTEGER,
        avg_hr INTEGER,
        max_hr INTEGER,
        coords TEXT,
        raw_data JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS sleep (
        id SERIAL PRIMARY KEY,
        date DATE UNIQUE NOT NULL,
        total_sleep INTEGER,
        deep_sleep INTEGER,
        light_sleep INTEGER,
        rem_sleep INTEGER,
        awake INTEGER,
        score INTEGER,
        raw_data JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS stress (
        id SERIAL PRIMARY KEY,
        date DATE UNIQUE NOT NULL,
        avg_stress INTEGER,
        max_stress INTEGER,
        raw_data JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_activities_source ON activities(source)`;

    return res.status(200).json({ 
      success: true, 
      message: 'Database tables created',
      tables: ['activities', 'sleep', 'stress']
    });

  } catch (error) {
    console.error('Setup error:', error);
    return res.status(500).json({ error: error.message });
  }
};
