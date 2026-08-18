const session = require('express-session');
const bcrypt = require('bcrypt');
const express = require('express');
const { Pool } = require('pg');

const app = express();

app.set('trust proxy', 1);

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
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-esta-chave-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

// ==============================================
// LOGIN
// ==============================================

app.post('/api/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
      return res.status(400).json({
        erro: 'Informe usuário e senha.'
      });
    }

    const resultado = await pool.query(
      `SELECT id, nome, usuario, senha_hash, perfil, ativo
       FROM usuarios
       WHERE usuario = $1`,
      [usuario]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({
        erro: 'Usuário ou senha inválidos.'
      });
    }

    const user = resultado.rows[0];

    if (!user.ativo) {
      return res.status(403).json({
        erro: 'Usuário desativado.'
      });
    }

    const senhaCorreta = await bcrypt.compare(
      senha,
      user.senha_hash
    );

    if (!senhaCorreta) {
      return res.status(401).json({
        erro: 'Usuário ou senha inválidos.'
      });
    }

    req.session.usuario = {
  id: user.id,
  nome: user.nome,
  usuario: user.usuario,
  perfil: user.perfil
};

req.session.save((erroSessao) => {

  if (erroSessao) {
    console.error('Erro ao salvar sessão:', erroSessao);

    return res.status(500).json({
      erro: 'Erro ao criar sessão do usuário.'
    });
  }

  console.log(
    'Sessão criada:',
    req.sessionID,
    req.session.usuario
  );

  res.json({
    sucesso: true,
    usuario: {
      id: user.id,
      nome: user.nome,
      usuario: user.usuario,
      perfil: user.perfil
    }
  });


    });

  } catch (erro) {
    console.error('Erro no login:', erro);

    res.status(500).json({
      erro: 'Erro interno ao realizar login.'
    });
  }
});

// ==============================================
// VERIFICAR USUÁRIO LOGADO
// ==============================================

app.get('/api/me', (req, res) => {
  if (!req.session.usuario) {
    return res.status(401).json({
      logado: false
    });
  }

  res.json({
    logado: true,
    usuario: req.session.usuario
  });
});


// ==============================================
// LOGOUT
// ==============================================

app.post('/api/logout', (req, res) => {
  req.session.destroy((erro) => {

    if (erro) {
      console.error('Erro ao encerrar sessão:', erro);

      return res.status(500).json({
        erro: 'Não foi possível sair do sistema.'
      });
    }

    res.clearCookie('connect.sid');

    res.json({
      sucesso: true
    });
  });
});


// ==============================================
// LISTAR USUÁRIOS - SOMENTE ADMIN
// ==============================================

app.get('/api/usuarios', exigirAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        nome,
        usuario,
        perfil,
        ativo,
        created_at
      FROM usuarios
      ORDER BY nome ASC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error('Erro ao listar usuários:', error);

    res.status(500).json({
      error: 'Erro ao listar usuários'
    });
  }
});


// ==============================================
// CADASTRAR USUÁRIO - SOMENTE ADMIN
// ==============================================

app.post('/api/usuarios', exigirAdmin, async (req, res) => {
  try {
    const {
      nome,
      usuario,
      senha,
      perfil
    } = req.body;

    if (!nome || !usuario || !senha || !perfil) {
      return res.status(400).json({
        error: 'Nome, usuário, senha e perfil são obrigatórios.'
      });
    }

    if (!['admin', 'usuario'].includes(perfil)) {
      return res.status(400).json({
        error: 'Perfil inválido.'
      });
    }

    if (senha.length < 6) {
      return res.status(400).json({
        error: 'A senha deve ter pelo menos 6 caracteres.'
      });
    }

    const existente = await pool.query(
      `SELECT id
       FROM usuarios
       WHERE usuario = $1`,
      [usuario.trim()]
    );

    if (existente.rowCount > 0) {
      return res.status(409).json({
        error: 'Este usuário já está cadastrado.'
      });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const result = await pool.query(`
      INSERT INTO usuarios
      (
        nome,
        usuario,
        senha_hash,
        perfil,
        ativo
      )
      VALUES ($1, $2, $3, $4, true)
      RETURNING
        id,
        nome,
        usuario,
        perfil,
        ativo,
        created_at
    `, [
      nome.trim(),
      usuario.trim(),
      senhaHash,
      perfil
    ]);

    res.status(201).json({
      sucesso: true,
      usuario: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao cadastrar usuário:', error);

    res.status(500).json({
      error: 'Erro ao cadastrar usuário.'
    });
  }
});


// ==============================================
// ATIVAR / DESATIVAR USUÁRIO - SOMENTE ADMIN
// ==============================================

app.patch('/api/usuarios/:id/status', exigirAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { ativo } = req.body;

    if (typeof ativo !== 'boolean') {
      return res.status(400).json({
        error: 'O campo ativo deve ser true ou false.'
      });
    }

    if (
      Number(id) === Number(req.session.usuario.id) &&
      ativo === false
    ) {
      return res.status(400).json({
        error: 'Você não pode desativar o próprio usuário.'
      });
    }

    const result = await pool.query(`
      UPDATE usuarios
      SET ativo = $1
      WHERE id = $2
      RETURNING
        id,
        nome,
        usuario,
        perfil,
        ativo
    `, [
      ativo,
      id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Usuário não encontrado.'
      });
    }

    res.json({
      sucesso: true,
      usuario: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao alterar status do usuário:', error);

    res.status(500).json({
      error: 'Erro ao alterar status do usuário.'
    });
  }
});


// ==============================================
// REDEFINIR SENHA - SOMENTE ADMIN
// ==============================================

app.patch('/api/usuarios/:id/senha', exigirAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { senha } = req.body;

    if (!senha || senha.length < 6) {
      return res.status(400).json({
        error: 'A nova senha deve ter pelo menos 6 caracteres.'
      });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const result = await pool.query(`
      UPDATE usuarios
      SET senha_hash = $1
      WHERE id = $2
      RETURNING
        id,
        nome,
        usuario,
        perfil,
        ativo
    `, [
      senhaHash,
      id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Usuário não encontrado.'
      });
    }

    res.json({
      sucesso: true,
      usuario: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao redefinir senha:', error);

    res.status(500).json({
      error: 'Erro ao redefinir senha.'
    });
  }
});


//====================================================== 
// MIDDLEWARE PARA EXIGIR LOGIN 
//======================================================

function exigirLogin(req, res, next) {
  if (!req.session.usuario) {
    return res.status(401).json({
      error: 'Usuário não autenticado.'
    });
  }

  next();
}


// ==========================================
// SOMENTE ADMINISTRADOR
// ==========================================

function exigirAdmin(req, res, next) {
  if (!req.session || !req.session.usuario) {
    return res.status(401).json({
      error: 'Usuário não autenticado.'
    });
  }

  if (req.session.usuario.perfil !== 'admin') {
    return res.status(403).json({
      error: 'Acesso permitido somente ao administrador.'
    });
  }

  next();
}

// =====================================================
// LISTAR TODOS OS REGISTROS
// =====================================================

app.get('/api/registros', exigirLogin, async (req, res) => {
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

app.get('/api/auditoria', exigirAdmin, async (req, res) => {
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
        usuario,
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

app.post('/api/registros/dia', exigirLogin, async (req, res) => {

  
  const usuarioLogado = req.session.usuario?.usuario || 'desconhecido';
  const { date, contagens } = req.body;

  if (!date || !Array.isArray(contagens)) {
    return res.status(400).json({
      error: 'date e contagens são obrigatórios'
    });
  }

  const client = await pool.connect();

  try {

    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.usuario', $1, true)`,
      [usuarioLogado]
    );

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

app.put('/api/registros/:id', exigirAdmin, async (req, res) => {

  const usuarioLogado = req.session.usuario?.usuario || 'desconhecido';
  const { count } = req.body;
  const { id } = req.params;

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    await client.query(
      `SELECT set_config('app.usuario', $1, true)`,
      [usuarioLogado]
    );

    const result = await client.query(`
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
      await client.query('ROLLBACK');

      return res.status(404).json({
        error: 'registro não encontrado'
      });
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      registro: result.rows[0]
    });

  } catch (error) {

    await client.query('ROLLBACK');

    console.error('Erro ao atualizar registro:', error);

    res.status(500).json({
      error: 'Erro ao atualizar registro'
    });

  } finally {

    client.release();

  }
});

// =====================================================
// EXCLUIR UM REGISTRO
// =====================================================

app.delete('/api/registros/:id', exigirAdmin, async (req, res) => {

  const usuarioLogado = req.session.usuario?.usuario || 'desconhecido';
  const { id } = req.params;

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    await client.query(
      `SELECT set_config('app.usuario', $1, true)`,
      [usuarioLogado]
    );

    const result = await client.query(`
      DELETE FROM registros
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        error: 'registro não encontrado'
      });
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Registro excluído com sucesso'
    });

  } catch (error) {

    await client.query('ROLLBACK');

    console.error('Erro ao excluir registro:', error);

    res.status(500).json({
      error: 'Erro ao excluir registro'
    });

  } finally {

    client.release();

  }
});

// =====================================================
// INICIAR SERVIDOR
// =====================================================

app.listen(PORT, '0.0.0.0', () => {

  console.log(`Servidor rodando na porta ${PORT}`);

});