const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// CONEXÃO COM POSTGRESQL
// =====================================================

if (!process.env.DATABASE_URL) {
  console.error('ERRO: DATABASE_URL não foi configurada.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

// Testa a conexão com o banco
pool.query('SELECT NOW()')
  .then(() => {
    console.log('✅ PostgreSQL conectado com sucesso!');
  })
  .catch((error) => {
    console.error('❌ Erro ao conectar ao PostgreSQL:', error.message);
  });

// =====================================================
// CONFIGURAÇÕES
// =====================================================

app.use(express.json());
app.use(express.static('public'));

// =====================================================
// LISTAR TODOS OS REGISTROS
// =====================================================

app.get('/api/registros', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        date,
        room,
        count,
        created_at,
        updated_at
      FROM registros
      ORDER BY date DESC, room ASC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error('Erro ao buscar registros:', error);
    res.status(500).json({
      error: 'Erro ao buscar registros'
    });
  }
});

// ================================================
// LISTAR AUDITORIA DOS REGISTROS
// ================================================

app.get('/api/auditoria', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        registro_id,
        acao,
        date,
        room,
        count,
        count_anterior,
        room_anterior,
        date_anterior,
        alterado_em
      FROM auditoria_registros
      ORDER BY alterado_em DESC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error('Erro ao buscar auditoria:', error);

    res.status(500).json({
      error: 'Erro ao buscar auditoria'
    });
  }
});


// =====================================================
// SALVAR CONTAGENS DE UM DIA
// =====================================================

app.post('/api/registros/dia', async (req, res) => {

  const { date, contagens } = req.body;

  if (!date || !Array.isArray(contagens)) {
    return res.status(400).json({
      error: 'date e contagens são obrigatórios'
    });
  }

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    for (const item of contagens) {

      const { room, count } = item;

      if (!room) {
        continue;
      }

      const id = `${date}|${room}`;

      await client.query(`
        INSERT INTO registros
          (id, date, room, count)
        VALUES
          ($1, $2, $3, $4)
        ON CONFLICT (date, room)
        DO UPDATE SET
          count = EXCLUDED.count,
          updated_at = CURRENT_TIMESTAMP
      `, [
        id,
        date,
        room,
        Number(count) || 0
      ]);
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Registros salvos com sucesso'
    });

  } catch (error) {

    await client.query('ROLLBACK');

    console.error('Erro ao salvar registros:', error);

    res.status(500).json({
      error: 'Erro ao salvar registros'
    });

  } finally {

    client.release();

  }
});

// =====================================================
// ATUALIZAR UM REGISTRO
// =====================================================

app.put('/api/registros/:id', async (req, res) => {

  const { count } = req.body;
  const { id } = req.params;

  try {

    const result = await pool.query(`
      UPDATE registros
      SET
        count = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [
      Number(count) || 0,
      id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'registro não encontrado'
      });
    }

    res.json({
      ok: true,
      registro: result.rows[0]
    });

  } catch (error) {

    console.error('Erro ao atualizar registro:', error);

    res.status(500).json({
      error: 'Erro ao atualizar registro'
    });
  }
});

// =====================================================
// EXCLUIR UM REGISTRO
// =====================================================

app.delete('/api/registros/:id', async (req, res) => {

  const { id } = req.params;

  try {

    const result = await pool.query(`
      DELETE FROM registros
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'registro não encontrado'
      });
    }

    res.json({
      ok: true,
      message: 'Registro excluído com sucesso'
    });

  } catch (error) {

    console.error('Erro ao excluir registro:', error);

    res.status(500).json({
      error: 'Erro ao excluir registro'
    });
  }
});

// =====================================================
// INICIAR SERVIDOR
// =====================================================

app.listen(PORT, '0.0.0.0', () => {

  console.log(`Servidor rodando na porta ${PORT}`);

});