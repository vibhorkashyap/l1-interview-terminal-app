(() => {
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));

  const screenStart = qs('#screen-start');
  const screenQuiz = qs('#screen-quiz');
  const screenCode = qs('#screen-code');
  const screenResult = qs('#screen-result');

  const nameInput = qs('#nameInput');
  const startBtn = qs('#startBtn');
  const nextBtn = qs('#nextBtn');
  const submitAllBtn = qs('#submitAllBtn');

  const questionText = qs('#questionText');
  const choicesEl = qs('#choices');
  const progressEl = qs('#progress');
  const promptEl = qs('#prompt');
  const codeEditor = qs('#codeEditor');
  const resultText = qs('#resultText');
  const timerEl = qs('#timer');

  let config = null;
  let questions = [];
  let coding = null;
  let sessionId = null;
  let currentIndex = 0;
  let selectedAnswers = {}; // qid -> choiceIndex
  let endTime = null;
  let timerInterval = null;

  function showScreen(id) {
    qsa('.screen').forEach(el => el.classList.remove('visible'));
    qs(`#${id}`).classList.add('visible');
  }

  function updateProgress() {
    progressEl.innerHTML = '';
    const total = questions.length;
    for (let i = 0; i < total; i++) {
      const li = document.createElement('li');
      li.textContent = String(i + 1);
      if (i < currentIndex) li.classList.add('done');
      if (i === currentIndex) li.classList.add('active');
      progressEl.appendChild(li);
    }
    if (coding) {
      const li = document.createElement('li');
      li.textContent = 'Code';
      if (currentIndex >= total) li.classList.add('active');
      progressEl.appendChild(li);
    }
  }

  function renderQuestion() {
    const q = questions[currentIndex];
    if (!q) return;
    questionText.textContent = q.question;
    choicesEl.innerHTML = '';
    q.choices.forEach((choice, idx) => {
      const div = document.createElement('div');
      div.className = 'choice';
      div.textContent = choice;
      if (selectedAnswers[q.id] === idx) div.classList.add('selected');
      div.addEventListener('click', () => {
        selectedAnswers[q.id] = idx;
        renderQuestion();
      });
      choicesEl.appendChild(div);
    });
    updateProgress();
  }

  function renderCoding() {
    promptEl.textContent = coding.prompt || '';
    codeEditor.value = coding.function_signature || '';
    updateProgress();
  }

  function startTimer(minutes) {
    const ms = minutes * 60 * 1000;
    endTime = Date.now() + ms;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const remaining = endTime - Date.now();
      if (remaining <= 0) {
        clearInterval(timerInterval);
        timerEl.textContent = '00:00';
        // Auto-submit when time runs out
        doSubmit();
        return;
      }
      const sec = Math.floor(remaining / 1000);
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      timerEl.textContent = `${mm}:${ss}`;
    }, 250);
  }

  async function init() {
    const [cfgRes, qRes] = await Promise.all([
      fetch('/api/config'),
      fetch('/api/questions')
    ]);
    config = await cfgRes.json();
    questions = await qRes.json();
    updateProgress();
  }

  async function fetchCoding() {
    const res = await fetch('/api/coding');
    if (res.ok) coding = await res.json();
  }

  startBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { alert('Please enter your name.'); return; }
    const res = await fetch('/api/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    sessionId = data.session_id;

    // Prepare quiz
    currentIndex = 0;
    updateProgress();
    renderQuestion();
    showScreen('screen-quiz');

    startTimer(config?.duration_minutes || 45);

    // Preload coding info
    await fetchCoding();
  });

  nextBtn.addEventListener('click', () => {
    if (currentIndex < questions.length - 1) {
      currentIndex += 1;
      renderQuestion();
    } else {
      // Move to coding
      showScreen('screen-code');
      renderCoding();
      currentIndex += 1; // indicate we've moved past MCQs
      updateProgress();
    }
  });

  async function doSubmit() {
    const answers = Object.entries(selectedAnswers).map(([qid, choice_index]) => ({ qid, choice_index }));
    const payload = {
      session_id: sessionId,
      answers,
      code: codeEditor.value || null,
    };
    const res = await fetch('/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    showScreen('screen-result');
    resultText.textContent = JSON.stringify(data, null, 2);
  }

  submitAllBtn.addEventListener('click', doSubmit);

  // Initialize screen
  init().catch(err => console.error(err));
})();
