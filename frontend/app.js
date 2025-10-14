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
  const runCodeBtn = qs('#runCodeBtn');
  const submitAllBtn = qs('#submitAllBtn');
  const testOutput = qs('#testOutput');
  const testResult = qs('#testResult');

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
  let sessionStartTime = null; // Track when session actually starts
  let codeEditorCM = null; // CodeMirror instance

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
    
    // Initialize CodeMirror if not already done
    if (!codeEditorCM) {
      codeEditorCM = CodeMirror.fromTextArea(codeEditor, {
        mode: 'python',
        theme: 'material-darker',
        lineNumbers: true,
        indentUnit: 4,
        indentWithTabs: false,
        autofocus: true,
        cursorScrollMargin: 5,
      });
      codeEditorCM.setSize('100%', '100%');
    }
    
    // Set the initial value
    codeEditorCM.setValue(coding.function_signature || '');
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
    const cfgRes = await fetch('/api/config');
    config = await cfgRes.json();
    updateProgress();
  }

  async function loadSessionQuestions() {
    if (!sessionId) return;
    const qRes = await fetch(`/api/questions?session_id=${sessionId}`);
    questions = await qRes.json();
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

    // Load session-specific questions
    await loadSessionQuestions();

    // Track session start time
    sessionStartTime = Date.now();

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
    
    // Calculate total time taken
    const totalTimeSeconds = sessionStartTime ? Math.floor((Date.now() - sessionStartTime) / 1000) : null;
    
    const payload = {
      session_id: sessionId,
      answers,
      code: codeEditorCM ? codeEditorCM.getValue() : null,
      total_time_seconds: totalTimeSeconds
    };
    const res = await fetch('/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    showScreen('screen-result');
    
    // Display enhanced results
    displayResults(data);
  }

  function downloadResults(data) {
    // Add timestamp and session info
    const resultsData = {
      ...data,
      session_info: {
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        interview_date: new Date().toLocaleDateString(),
        interview_time: new Date().toLocaleTimeString()
      }
    };

    // Create downloadable JSON
    const dataStr = JSON.stringify(resultsData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `interview_results_${data.candidate_name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  }

  function displayResults(data) {
    let html = `
      <div class="result-summary">
        <h3>Interview Completed!</h3>
        <p>Thank you for taking the assessment.</p>
        <div class="download-section">
          <button id="downloadResultsBtn" class="download-btn">Download Results JSON</button>
        </div>
      </div>
    `;

    resultText.innerHTML = html;
    
    // Add download functionality
    const downloadBtn = document.getElementById('downloadResultsBtn');
    
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => downloadResults(data));
    }
  }

  async function runCode() {
    const code = codeEditorCM ? codeEditorCM.getValue().trim() : '';
    if (!code) {
      alert('Please enter some code first!');
      return;
    }

    testOutput.style.display = 'block';
    testResult.textContent = 'Running code...';

    try {
      const response = await fetch('/api/test-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code: code,
          session_id: sessionId 
        })
      });

      const result = await response.json();
      
      if (result.error) {
        testResult.textContent = `Error: ${result.error}`;
        testResult.className = 'test-result error';
      } else {
        let output = 'Test Results:\n\n';
        result.details.forEach((test, index) => {
          output += `Test ${index + 1}: ${test.passed ? 'PASSED' : 'FAILED'}\n`;
          output += `Input: ${JSON.stringify(test.input)}\n`;
          if (test.expected !== undefined) {
            output += `Expected: ${JSON.stringify(test.expected)}\n`;
          }
          if (test.actual !== undefined) {
            output += `Your output: ${JSON.stringify(test.actual)}\n`;
          }
          if (test.error) {
            output += `Error: ${test.error}\n`;
          }
          output += '\n';
        });
        testResult.textContent = output;
        testResult.className = result.passed ? 'test-result success' : 'test-result partial';
      }
    } catch (error) {
      testResult.textContent = `Network Error: ${error.message}`;
      testResult.className = 'test-result error';
    }
  }

  runCodeBtn.addEventListener('click', runCode);
  submitAllBtn.addEventListener('click', doSubmit);

  // Initialize screen
  init().catch(err => console.error(err));
})();
