const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');

// Inicializando o app Express
const app = express();
const port = 5000;

// Conexão com o MongoDB (Lê da variável de ambiente MONGO_URI ou usa o padrão local)
const mongoUri = process.env.MONGO_URI || 'mongodb://root:rootpassword@mongo-todo:27017/todo-app?authSource=admin';

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
})
  .then(() => console.log('Conectado ao MongoDB'))
  .catch((err) => console.error('Erro ao conectar ao MongoDB:', err));

// ===== OBSERVABILIDADE: log estruturado de requisições HTTP =====
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  req.requestId = crypto.randomUUID();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'backend',
      environment: process.env.NODE_ENV || 'production',
      level: res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO',
      event: 'http_request',
      requestId: req.requestId,
      method: req.method,
      route: req.route ? req.route.path : req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      clientIp: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
      userAgent: req.headers['user-agent'] || 'unknown',
    }));
  });

  next();
});

// ===== OBSERVABILIDADE: helper de log de operação de banco =====
async function logDbOperation(operation, collection, fn, meta = {}) {
  const start = process.hrtime.bigint();
  try {
    const result = await fn();
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'backend',
      level: 'INFO',
      event: 'db_operation',
      operation,
      collection,
      result: 'success',
      durationMs: Math.round(durationMs * 100) / 100,
      requestId: meta.requestId,
      userAgent: meta.userAgent,
    }));
    return result;
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'backend',
      level: 'ERROR',
      event: 'db_operation',
      operation,
      collection,
      result: 'failure',
      errorType: err.name,
      errorMessage: err.message,
      durationMs: Math.round(durationMs * 100) / 100,
      requestId: meta.requestId,
      userAgent: meta.userAgent,
    }));
    throw err;
  }
}

// Middleware para habilitar CORS liberando o API Gateway e métodos necessários
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());

// Definindo o modelo de Tarefa (To-do)
const TodoSchema = new mongoose.Schema({
  text: { type: String, required: true },
  completed: { type: Boolean, default: false },
});

const Todo = mongoose.model('Todo', TodoSchema);

// Rota para obter todas as tarefas (GET)
app.get('/todos', async (req, res) => {
  try {
    const todos = await logDbOperation('find', 'todos', () => Todo.find(), {
      requestId: req.requestId,
      userAgent: req.headers['user-agent'],
    });
    res.json(todos);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Rota para adicionar uma nova tarefa (POST)
app.post('/todos', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ message: 'O campo "text" é obrigatório' });
  }

  const todo = new Todo({
    text,
    completed: false,
  });

  try {
    const newTodo = await logDbOperation('insertOne', 'todos', () => todo.save(), {
      requestId: req.requestId,
      userAgent: req.headers['user-agent'],
    });
    res.status(201).json(newTodo);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Rota para marcar uma tarefa como concluída (PATCH)
app.patch('/todos/:id', async (req, res) => {
  try {
    const todo = await logDbOperation('findById', 'todos', () => Todo.findById(req.params.id), {
      requestId: req.requestId,
      userAgent: req.headers['user-agent'],
    });

    if (!todo) {
      return res.status(404).json({ message: 'Tarefa não encontrada' });
    }

    todo.completed = !todo.completed;
    await logDbOperation('updateOne', 'todos', () => todo.save(), {
      requestId: req.requestId,
      userAgent: req.headers['user-agent'],
    });
    res.json(todo);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Rota para excluir uma tarefa (DELETE)
app.delete('/todos/:id', async (req, res) => {
  try {
    const todo = await logDbOperation('findByIdAndDelete', 'todos', () => Todo.findByIdAndDelete(req.params.id), {
      requestId: req.requestId,
      userAgent: req.headers['user-agent'],
    });

    if (!todo) {
      return res.status(404).json({ message: 'Tarefa não encontrada' });
    }

    res.json({ message: 'Tarefa excluída com sucesso' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Iniciando o servidor na porta 5000
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
