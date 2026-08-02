const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'registros.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Banco de dados (arquivo JSON) ----------
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
}

function readRecords() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function writeRecords(records) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

// ---------- Rotas da API ----------

// Lista todos os registros
app.get('/api/registros', (req, res) => {
  res.json(readRecords());
});

// Salva/atualiza as contagens de um dia inteiro
// body: { date: "2026-08-02", contagens: [{room: "1°A", count: 25}, ...] }
app.post('/api/registros/dia', (req, res) => {
  const { date, contagens } = req.body;
  if (!date || !Array.isArray(contagens)) {
    return res.status(400).json({ error: 'date e contagens são obrigatórios' });
  }
  const records = readRecords();
  contagens.forEach(({ room, count }) => {
    const id = `${date}|${room}`;
    const idx = records.findIndex(r => r.id === id);
    if (idx >= 0) {
      records[idx].count = count;
    } else {
      records.push({ id, date, room, count });
    }
  });
  writeRecords(records);
  res.json({ ok: true });
});

// Atualiza um registro específico (edição na aba Registros)
app.put('/api/registros/:id', (req, res) => {
  const { count } = req.body;
  const records = readRecords();
  const idx = records.findIndex(r => r.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'registro não encontrado' });
  records[idx].count = Number(count) || 0;
  writeRecords(records);
  res.json({ ok: true });
});

// Exclui um registro
app.delete('/api/registros/:id', (req, res) => {
  let records = readRecords();
  records = records.filter(r => r.id !== req.params.id);
  writeRecords(records);
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log('Para acessar de um celular na mesma rede Wi-Fi, use o IP deste computador em vez de "localhost".');
});
