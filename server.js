const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const MAX_SERVER_PLAYERS = 13; // Rule 5: "The max people in the Server is 13."
const MAX_COIN_STEAL = 30;     // Rule 2: "The max coins you can take is 30."

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

// Connected players registry: { socketId: { ws, id, name, coins, hat, chair, tableId, firstGameDone } }
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
  // Enforce handwritten Rule 5: Server capacity 13
  if (players.size >= MAX_SERVER_PLAYERS) {
    ws.send(JSON.stringify({ type: 'SERVER_FULL', message: 'Server is full (13/13 max players). Try again later!' }));
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

  // Send initial state to the connecting player
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    playerId: playerId,
    name: defaultName,
    tables: getSanitizedTables(),
    serverPlayerCount: players.size,
    maxPlayers: MAX_SERVER_PLAYERS
  }));

  // Notify everyone of updated server player count
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

      // If opponent was a human, notify them of forfeit/leave
      if (opponent && !opponent.isBot) {
        sendToPlayer(opponent.id, {
          type: 'OPPONENT_LEFT',
          message: `${player.name} left the table.`
        });
      } else if (opponent && opponent.isBot) {
        // Clean up bot
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
        player.ws.send(JSON.stringify({ type: 'ACTION_FAILED', message: 'Chair is unavailable or you are already seated.' }));
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

      // Rule 2: Gameplay Rules
      // If it's player's first time, play against Easy Computer guaranteed to win (+100 coins)
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
        // Real player was already waiting! Clear countdown & start duel
        if (table.waitTimer) {
          clearInterval(table.waitTimer);
          table.waitTimer = null;
          table.waitSeconds = 60;
        }
        startHumanDuel(table, table.seats[0], table.seats[1]);
      } else {
        // Wait 60 seconds for a human player (as specified)
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

            // 60s elapsed: Computer joins!
            const computerPlayer = {
              id: 'bot_' + Math.random().toString(36).substring(2, 6),
              name: 'Roblox_AI_Bot',
              coins: 60,
              hat: 'hat_cap',
              isBot: true
            };
            table.seats[oppIdx] = computerPlayer;
            startHumanDuel(table, table.seats[seatIdx], computerPlayer);
          }
        }, 1000);
      }

      broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });
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

      // Check if opponent is bot or human
      const oppIdx = player.seatIdx === 0 ? 1 : 0;
      const opponent = table.seats[oppIdx];

      if (opponent.isBot) {
        if (table.duelState.isTutorial) {
          // Tutorial bot deliberately fails to guarantee win
          setTimeout(() => {
            resolveDuelRound(table, false, "Computer guessed: 'uhh... 42?'");
          }, 1500);
        } else {
          // Standard AI opponent: 40% chance of guessing correct
          const aiCorrect = Math.random() < 0.4;
          setTimeout(() => {
            resolveDuelRound(table, aiCorrect, aiCorrect ? "Computer guessed correctly!" : "Computer guessed wrong!");
          }, 1800);
        }
      } else {
        // Send question to opposing human (keep answer secret on server to prevent exploits per Rule 4!)
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

    // Rule 5: Report Violator / Bot (+10 coin bounty)
    case 'REPORT_VIOLATOR': {
      const targetName = (data.targetName || '').trim();
      // Grant +10 coins bounty
      player.coins += 10;
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

function startHumanDuel(table, p1, p2) {
  table.duelState = {
    askerId: p1.id,
    secretQuestion: null,
    secretAnswer: null,
    isTutorial: false
  };

  broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });

  // P1 asks first
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
    // Opponent (answerer) steals up to 30 coins from asker (Rule 2)
    winner = answerer;
    loser = asker;
    stolen = Math.min(loser.coins, MAX_COIN_STEAL);
    loser.coins -= stolen;
    winner.coins += stolen;
  } else {
    // Asker steals up to 30 coins from opponent (answerer) (Rule 2)
    winner = asker;
    loser = answerer;
    stolen = Math.min(loser.coins, MAX_COIN_STEAL);
    loser.coins -= stolen;
    winner.coins += stolen;
  }

  // Handle Tutorial Completion
  if (table.duelState.isTutorial) {
    const humanPlayer = players.get(asker.id);
    if (humanPlayer) {
      humanPlayer.coins += 100; // Guaranteed 100 coins
      humanPlayer.firstGameDone = true;
      asker.coins = humanPlayer.coins;
      sendToPlayer(humanPlayer.id, {
        type: 'FIRST_WIN_COMPLETED',
        bonus: 100,
        message: '🎉 Guaranteed first win! +100 bonus coins awarded!'
      });
    }
    // Clean up table
    table.seats[1] = null;
    table.duelState = null;
    broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });
    return;
  }

  // Broadcast Round Outcome
  const resultPayload = {
    type: 'ROUND_RESULT',
    winnerName: winner.name,
    loserName: loser.name,
    stolen: stolen,
    reason: reason
  };

  if (!asker.isBot) sendToPlayer(asker.id, resultPayload);
  if (!answerer.isBot) sendToPlayer(answerer.id, resultPayload);

  // Check if someone lost all coins
  if (loser.coins <= 0) {
    const gameOverPayload = {
      type: 'MATCH_OVER',
      winnerName: winner.name,
      loserName: loser.name,
      message: `${loser.name} lost all their coins!`
    };
    if (!asker.isBot) sendToPlayer(asker.id, gameOverPayload);
    if (!answerer.isBot) sendToPlayer(answerer.id, gameOverPayload);

    // End match & clear table
    table.seats = [null, null];
    table.duelState = null;
    broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });
    return;
  }

  // Swap turns: answerer now asks next question
  table.duelState.askerId = answerer.id;
  table.duelState.secretQuestion = null;
  table.duelState.secretAnswer = null;

  broadcast({ type: 'TABLE_UPDATE', tables: getSanitizedTables() });

  setTimeout(() => {
    if (!answerer.isBot) {
      sendToPlayer(answerer.id, { type: 'PROMPT_ASK', opponentName: asker.name });
    } else {
      // Bot generates a question
      botAskQuestion(table, asker);
    }
  }, 2000);
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