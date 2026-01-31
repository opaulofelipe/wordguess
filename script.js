/* =========================
   Utilitários
========================= */
const $ = (sel) => document.querySelector(sel);

function normalizeStr(s) {
  // Remove APENAS acentos (não mexe com hífen, espaços internos, etc.)
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickUniqueIndices(maxLen, count, validFn) {
  const pool = [];
  for (let i = 0; i < maxLen; i++) if (validFn(i)) pool.push(i);

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* =========================
   Bloqueio de zoom (double-tap / gestos)
========================= */
(function blockZoom() {
  // Safari iOS pinch
  document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });

  // Double-tap zoom
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
  );
})();

/* =========================
   Áudio de acerto (acerto.mp3 na raiz)
   Observação: iOS exige interação do usuário antes de tocar áudio.
   Aqui garantimos isso "armando" o áudio no primeiro toque/tecla.
========================= */
const hitSound = new Audio("./acerto.mp3");
hitSound.preload = "auto";
hitSound.volume = 0.9;

let audioUnlocked = false;
async function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    // toca em volume 0 rapidamente para "desbloquear" no iOS
    const prevVol = hitSound.volume;
    hitSound.volume = 0;
    await hitSound.play();
    hitSound.pause();
    hitSound.currentTime = 0;
    hitSound.volume = prevVol;
  } catch {
    // se falhar, tudo bem: ainda tentaremos tocar quando acertar
  }
}
["pointerdown", "touchstart", "keydown"].forEach((evt) => {
  window.addEventListener(evt, unlockAudioOnce, { once: true, passive: true });
});

function playHitSound() {
  try {
    hitSound.currentTime = 0;
    hitSound.play();
  } catch {
    // ignora (alguns browsers podem bloquear se não houve interação)
  }
}

/* =========================
   Confetti (canvas simples)
========================= */
const confetti = {
  canvas: $("#confetti"),
  ctx: null,
  pieces: [],
  running: false,

  resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = window.innerWidth + "px";
    this.canvas.style.height = window.innerHeight + "px";
    this.ctx = this.canvas.getContext("2d");
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  burst() {
    this.resize();
    const w = window.innerWidth;
    const h = window.innerHeight;

    const palette = ["#6fd3c7", "#a9b7ff", "#ff8a9a", "#79d49b", "#ffd08a"];
    const n = 140;

    this.pieces = Array.from({ length: n }, () => ({
      x: w / 2 + randInt(-60, 60),
      y: h * 0.25 + randInt(-20, 20),
      vx: (Math.random() - 0.5) * 7,
      vy: Math.random() * -7 - 3,
      g: 0.18 + Math.random() * 0.07,
      r: randInt(3, 6),
      a: 1,
      fade: 0.006 + Math.random() * 0.008,
      c: palette[randInt(0, palette.length - 1)],
    }));

    this.running = true;

    const tick = () => {
      if (!this.running) return;
      this.ctx.clearRect(0, 0, w, h);

      let alive = 0;
      for (const p of this.pieces) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.a = Math.max(0, p.a - p.fade);

        if (p.a > 0 && p.y < h + 20) {
          alive++;
          this.ctx.globalAlpha = p.a;
          this.ctx.fillStyle = p.c;
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }

      this.ctx.globalAlpha = 1;

      if (alive > 0) requestAnimationFrame(tick);
      else {
        this.running = false;
        this.ctx.clearRect(0, 0, w, h);
      }
    };

    requestAnimationFrame(tick);
  },
};

window.addEventListener("resize", () => confetti.resize());

/* =========================
   Estado do jogo
========================= */
let dados = [];
let fila = [];
let atual = null;

let tentativasRestantes = 4;
let indicesRevelados = [];

const elTentativas = $("#tentativas");
const elDica = $("#dica");
const elMascara = $("#mascara");
const elChute = $("#chute");
const elFeedback = $("#feedback");

const modalBackdrop = $("#modalBackdrop");
const modalTitle = $("#modalTitle");
const modalText = $("#modalText");
const modalBtn = $("#modalBtn");

function showModal(title, text, buttonLabel = "Próxima") {
  modalTitle.textContent = title;
  modalText.textContent = text;
  modalBtn.textContent = buttonLabel;
  modalBackdrop.hidden = false;
  modalBtn.focus();
}

function hideModal() {
  modalBackdrop.hidden = true;
}

function updateMeta() {
  elTentativas.textContent = `${tentativasRestantes} tentativa${tentativasRestantes === 1 ? "" : "s"}`;
}

function renderMask() {
  const word = atual.palavra;
  elMascara.innerHTML = "";

  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const isSpace = ch === " " || ch === "-";
    const revealed = indicesRevelados.includes(i);

    const cell = document.createElement("span");
    cell.className = "cell" + (revealed ? " revealed" : "") + (isSpace ? " space" : "");
    cell.textContent = isSpace ? " " : (revealed ? ch.toUpperCase() : "_");
    elMascara.appendChild(cell);
  }
}

function prepareReveals(word, revealCount = 3) {
  // revela 3 letras em posições aleatórias (ignorando espaço/hífen)
  const valid = (i) => {
    const ch = word[i];
    return ch !== " " && ch !== "-" && ch !== "_" && ch !== "\t";
  };
  return pickUniqueIndices(word.length, revealCount, valid);
}

function nextRound() {
  elFeedback.textContent = "";
  elChute.value = "";

  if (fila.length === 0) fila = shuffle(dados);

  atual = fila.shift();
  tentativasRestantes = 4;
  indicesRevelados = prepareReveals(atual.palavra, 3);

  elDica.textContent = atual.dica;
  updateMeta();
  renderMask();

  setTimeout(() => elChute.focus(), 50);
}

function revealAnswerInMask() {
  indicesRevelados = Array.from({ length: atual.palavra.length }, (_, i) => i);
  renderMask();
}

function handleGuess(rawGuess) {
  const guess = normalizeStr(rawGuess);
  const answer = normalizeStr(atual.palavra);

  if (!guess) {
    elFeedback.textContent = "Digite alguma coisa 🙂";
    return;
  }

  if (guess === answer) {
    revealAnswerInMask();

    // ✅ SOM DE ACERTO
    playHitSound();

    confetti.burst();
    showModal("Parabéns! 🎉", `Você acertou: ${atual.palavra.toUpperCase()}`, "Próxima");
    return;
  }

  tentativasRestantes--;
  updateMeta();

  if (tentativasRestantes > 0) {
    elFeedback.textContent = "Não foi dessa vez. Tente de novo.";
  } else {
    revealAnswerInMask();
    showModal("Que pena 😕", `Você errou. A resposta era: ${atual.palavra.toUpperCase()}`, "Próxima");
  }
}

/* =========================
   Eventos
========================= */
$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  handleGuess(elChute.value);
});

$("#pular").addEventListener("click", () => nextRound());

$("#reiniciar").addEventListener("click", () => {
  fila = shuffle(dados);
  nextRound();
});

modalBtn.addEventListener("click", () => {
  hideModal();
  nextRound();
});

modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) hideModal();
});

/* =========================
   Carregar JSON e iniciar
========================= */
async function init() {
  try {
    const res = await fetch("palavras.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Não foi possível carregar palavras.json");
    const json = await res.json();

    // Aceita dois formatos: array direto ou {itens:[...]}
    dados = Array.isArray(json) ? json : (json?.itens ?? []);
    if (!dados.length) throw new Error("palavras.json veio vazio");

    fila = shuffle(dados);
    nextRound();
  } catch (err) {
    elDica.textContent = "Erro ao carregar o jogo.";
    elFeedback.textContent = String(err?.message ?? err);
  }
}

init();