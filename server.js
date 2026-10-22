const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const MAX_SERVER_PLAYERS = 13; // Rule 5: Server capacity 13
const MAX_COIN_STEAL = 30;     // Rule 2: Max coins you can take is 30

// Serve index.html statically
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Tables setup: 3 tables * 2 chairs = 6 players playing max (Rule 1)
const tables = [
  { id: 1, seats: [null, null], duelState: null, waitTimer: null, waitSeconds: 60 },
  { id: 2, seats: [null, null], duelState: null, waitTimer: null, waitSeconds: 60 },
  { id: 3, seats: [null, null], duelState: null, waitTimer: null, waitSeconds: 60 }
];

const players = new Map();

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function getSanitizedTables() {
  return tables.map(t => ({
    id: t.id,
    seats: t.seats.map(s => s ? {
      id: s.id,
      name: s.name,
      coins: s.coins,
      hat: s.hat,
      isBot: s.isBot || false
    } : null),
    waitSeconds: t.waitSeconds,
    hasActiveDuel: !!t.duelState
  }));
}

function sendToPlayer(playerId, payload) {
  const p = players.get(playerId);
  if (p && p.ws.readyState === WebSocket.OPEN) {
    p.ws.send(JSON.stringify(payload));
  }
}

wss.on('connection', (ws) => {
  if (players.size >= MAX_SERVER_PLAYERS) {
    ws.send(JSON.stringify({ type: 'SERVER_FULL', message: 'Server is full (13/13 max players).' }));
    ws.close();
    return;
  }

  const playerId = 'user_' + Math.random().toString(36).substring(2, 9);
  const defaultName = 'Noob_' + playerId.substring(5);

  const playerData = {
    ws,
    id: playerId,
    name: defaultName,
    coins: 0,
    hat: 'hat_none',
    tableId: null,
    seatIdx: null,
    firstGameDone: false
  };
  players.set(playerId, playerData);

  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    playerId: playerId,
    name: defaultName,
    tables: getSanitizedTables(),
    serverPlayerCount: players.size,
    maxPlayers: MAX_SERVER_PLAYERS
  }));

  broadcast({
    type: 'SERVER_INFO',
    count: players.size,
    tables: getSanitizedTables()
  });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      handleMessage(playerData, data);
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  ws.on('close', () => {
    handlePlayerLeave(playerData);
    players.delete(playerId);
    broadcast({
      type: 'SERVER_INFO',
      count: players.size,
      tables: getSanitizedTables()
    });
  });
});

function handlePlayerLeave(player) {
  if (player.tableId !== null && player.seatIdx !== null) {
    const table = tables.find(t => t.id === player.tableId);
    if (table) {
      table.seats[player.seatIdx] = null;
      if (table.waitTimer) {
        clearInterval(table.waitTimer);
        table.waitTimer = null;
        table.waitSeconds = 60;
      }
      
      const oppIdx = player.seatIdx === 0 ? 1 : 0;
      const opponent = table.seats[oppIdx];

      if (opponent && !opponent.isBot) {
        sendToPlayer(opponent.id, {
          type: 'OPPONENT_LEFT',
          message: `${player.name} left the table.`
        });
      } else if (opponent && opponent.isBot) {
        table.seats[oppIdx] = null;
      }

      table.duelState = null;
      player.tableId = null;
      player.seatIdx = null;
      broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });
    }
  }
}

function handleMessage(player, data) {
  switch (data.type) {
    case 'SYNC_PROFILE': {
      player.coins = parseInt(data.coins) || 0;
      player.hat = data.hat || 'hat_none';
      player.firstGameDone = !!data.firstGameDone;
      break;
    }

    case 'SIT_AT_TABLE': {
      const table = tables.find(t => t.id === data.tableId);
      if (!table) return;

      const seatIdx = data.seatIdx;
      if (table.seats[seatIdx] !== null || player.tableId !== null) {
        player.ws.send(JSON.stringify({ type: 'ACTION_FAILED', message: 'Chair is occupied or you are already seated.' }));
        return;
      }

      player.tableId = table.id;
      player.seatIdx = seatIdx;
      table.seats[seatIdx] = {
        id: player.id,
        name: player.name,
        coins: player.coins,
        hat: player.hat,
        isBot: false
      };

      // Guaranteed win tutorial for brand new players
      if (!player.firstGameDone) {
        const otherIdx = seatIdx === 0 ? 1 : 0;
        const tutorialBot = {
          id: 'bot_tutorial',
          name: 'Computer (Easy)',
          coins: 40,
          hat: 'hat_none',
          isBot: true
        };
        table.seats[otherIdx] = tutorialBot;
        table.duelState = {
          askerId: player.id,
          secretQuestion: null,
          secretAnswer: null,
          isTutorial: true
        };
        broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });
        sendToPlayer(player.id, {
          type: 'START_TUTORIAL_MATCH',
          message: 'Welcome! First game is vs Computer with guaranteed win for 100 coins!'
        });
        return;
      }

      const oppIdx = seatIdx === 0 ? 1 : 0;
      const existingOpp = table.seats[oppIdx];

      if (existingOpp) {
        if (table.waitTimer) {
          clearInterval(table.waitTimer);
          table.waitTimer = null;
          table.waitSeconds = 60;
        }
        startDuel(table, table.seats[0], table.seats[1]);
      } else {
        // Wait 60s for human, or user can click "Play with Computer Now"
        table.waitSeconds = 60;
        broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });

        if (table.waitTimer) clearInterval(table.waitTimer);
        table.waitTimer = setInterval(() => {
          table.waitSeconds--;
          if (table.waitSeconds > 0) {
            broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });
          } else {
            clearInterval(table.waitTimer);
            table.waitTimer = null;
            spawnComputerOpponent(table, player);
          }
        }, 1000);
      }

      broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });
      break;
    }

    // Instant Computer Opponent trigger
    case 'FORCE_COMPUTER_OPPONENT': {
      const table = tables.find(t => t.id === player.tableId);
      if (!table) return;
      if (table.waitTimer) {
        clearInterval(table.waitTimer);
        table.waitTimer = null;
      }
      spawnComputerOpponent(table, player);
      break;
    }

    case 'STAND_UP': {
      handlePlayerLeave(player);
      break;
    }

    case 'SUBMIT_QUESTION': {
      const table = tables.find(t => t.id === player.tableId);
      if (!table || !table.duelState) return;

      const { question, answer } = data;
      if (!question || !answer) return;

      table.duelState.secretQuestion = question.trim();
      table.duelState.secretAnswer = answer.trim().toLowerCase();

      const oppIdx = player.seatIdx === 0 ? 1 : 0;
      const opponent = table.seats[oppIdx];

      if (opponent.isBot) {
        if (table.duelState.isTutorial) {
          setTimeout(() => {
            resolveDuelRound(table, false, "Computer guessed: 'uhh... 42?'");
          }, 1200);
        } else {
          const aiCorrect = Math.random() < 0.35;
          setTimeout(() => {
            resolveDuelRound(table, aiCorrect, aiCorrect ? "Computer guessed correctly!" : "Computer guessed wrong!");
          }, 1500);
        }
      } else {
        sendToPlayer(opponent.id, {
          type: 'PROMPT_ANSWER',
          question: question,
          askerName: player.name
        });
      }
      break;
    }

    case 'SUBMIT_ANSWER': {
      const table = tables.find(t => t.id === player.tableId);
      if (!table || !table.duelState) return;

      const userAns = (data.answer || '').trim().toLowerCase();
      const isCorrect = userAns === table.duelState.secretAnswer;
      resolveDuelRound(table, isCorrect, isCorrect ? `${player.name} answered correctly!` : `${player.name} got it wrong!`);
      break;
    }

    case 'REPORT_VIOLATOR': {
      const targetName = (data.targetName || '').trim();
      player.coins += 10; // Rule 5: 10 coins bounty
      sendToPlayer(player.id, {
        type: 'REPORT_SUCCESS',
        bounty: 10,
        message: `Report filed for "${targetName}". Violator banned! Handwritten Rule 5 reward: +10 Coins!`
      });
      broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });
      break;
    }
  }
}

function spawnComputerOpponent(table, player) {
  const oppIdx = player.seatIdx === 0 ? 1 : 0;
  if (table.seats[oppIdx] !== null) return;

  const computerPlayer = {
    id: 'bot_' + Math.random().toString(36).substring(2, 6),
    name: 'Roblox_AI_Bot',
    coins: 60,
    hat: 'hat_cap',
    isBot: true
  };
  table.seats[oppIdx] = computerPlayer;
  startDuel(table, table.seats[player.seatIdx], computerPlayer);
}

function startDuel(table, p1, p2) {
  table.duelState = {
    askerId: p1.id,
    secretQuestion: null,
    secretAnswer: null,
    isTutorial: false
  };

  broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });

  if (!p1.isBot) {
    sendToPlayer(p1.id, { type: 'PROMPT_ASK', opponentName: p2.name });
  }
  if (!p2.isBot) {
    sendToPlayer(p2.id, { type: 'WAITING_FOR_QUESTION', opponentName: p1.name });
  }
}

function resolveDuelRound(table, opponentGotCorrect, reason) {
  if (!table || !table.duelState) return;

  const askerSeatIdx = table.seats.findIndex(s => s && s.id === table.duelState.askerId);
  const answererSeatIdx = askerSeatIdx === 0 ? 1 : 0;

  const asker = table.seats[askerSeatIdx];
  const answerer = table.seats[answererSeatIdx];

  let winner, loser, stolen;

  if (opponentGotCorrect) {
    winner = answerer;
    loser = asker;
    stolen = Math.min(loser.coins, MAX_COIN_STEAL);
    loser.coins -= stolen;
    winner.coins += stolen;
  } else {
    winner = asker;
    loser = answerer;
    stolen = Math.min(loser.coins, MAX_COIN_STEAL);
    loser.coins -= stolen;
    winner.coins += stolen;
  }

  if (table.duelState.isTutorial) {
    const humanPlayer = players.get(asker.id);
    if (humanPlayer) {
      humanPlayer.coins += 100;
      humanPlayer.firstGameDone = true;
      asker.coins = humanPlayer.coins;
      sendToPlayer(humanPlayer.id, {
        type: 'FIRST_WIN_COMPLETED',
        bonus: 100,
        message: '🎉 Guaranteed first win! +100 bonus coins awarded!'
      });
    }
    table.seats[1] = null;
    table.duelState = null;
    broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });
    return;
  }

  const resultPayload = {
    type: 'ROUND_RESULT',
    winnerName: winner.name,
    loserName: loser.name,
    stolen: stolen,
    reason: reason
  };

  if (!asker.isBot) sendToPlayer(asker.id, resultPayload);
  if (!answerer.isBot) sendToPlayer(answerer.id, resultPayload);

  if (loser.coins <= 0) {
    const gameOverPayload = {
      type: 'MATCH_OVER',
      winnerName: winner.name,
      loserName: loser.name,
      message: `${loser.name} lost all their coins!`
    };
    if (!asker.isBot) sendToPlayer(asker.id, gameOverPayload);
    if (!answerer.isBot) sendToPlayer(answerer.id, gameOverPayload);

    table.seats = [null, null];
    table.duelState = null;
    broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });
    return;
  }

  table.duelState.askerId = answerer.id;
  table.duelState.secretQuestion = null;
  table.duelState.secretAnswer = null;

  broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });

  setTimeout(() => {
    if (!answerer.isBot) {
      sendToPlayer(answerer.id, { type: 'PROMPT_ASK', opponentName: asker.name });
    } else {
      botAskQuestion(table, asker);
    }
  }, 1800);
}

function botAskQuestion(table, humanPlayer) {
  const botQuestions = [
    { q: "What color is a Roblox noob's torso?", a: "blue" },
    { q: "What color is a Roblox noob's head?", a: "yellow" },
    { q: "What is 15 + 15?", a: "30" },
    { q: "How many legs does a spider have?", a: "8" }
  ];
  const chosen = botQuestions[Math.floor(Math.random() * botQuestions.length)];
  table.duelState.secretQuestion = chosen.q;
  table.duelState.secretAnswer = chosen.a;

  sendToPlayer(humanPlayer.id, {
    type: 'PROMPT_ANSWER',
    question: chosen.q,
    askerName: 'Roblox_AI_Bot'
  });
}

server.listen(PORT, () => {
  console.log(`Roblox Noob Q&A server listening on port ${PORT}`);
});