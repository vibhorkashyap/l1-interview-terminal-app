(() => {
  const API_BASE = (window.API_BASE || '').replace(/\/$/, '');
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));

  const screenStart = qs('#screen-start');
  const screenQuiz = qs('#screen-quiz');
  const screenCode = qs('#screen-code');
  const screenResult = qs('#screen-result');

  const nameInput = qs('#nameInput');
  const startBtn = qs('#startBtn');
  const nameValidation = qs('#nameValidation');
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
  let typingTimer = null; // Typewriter animation timer
  let isAdvancing = false; // Prevent multiple clicks during selection

  function showScreen(id) {
    // Cancel any ongoing typing when switching screens
    cancelTyping();
    qsa('.screen').forEach(el => el.classList.remove('visible'));
    qs(`#${id}`).classList.add('visible');
  }

  function cancelTyping() {
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
  }

  function typeText(element, text, charactersPerSecond = 50) {
    return new Promise((resolve) => {
      cancelTyping();
      element.textContent = '';
      element.classList.add('typing');
      
      let i = 0;
      const tick = () => {
        if (i <= text.length) {
          element.textContent = text.slice(0, i);
          i++;
          if (i <= text.length) {
            typingTimer = setTimeout(tick, 1000 / charactersPerSecond);
          } else {
            element.classList.remove('typing');
            resolve();
          }
        }
      };
      tick();
    });
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
    
    // Cancel any existing typing and reset advancing state
    cancelTyping();
    isAdvancing = false;
    
    // Remove disabled state from choices container
    choicesEl.classList.remove('disabled');
    
    // Start typewriter effect for question
    typeText(questionText, q.question, 60);
    
    // Render choices immediately (they appear all at once)
    choicesEl.innerHTML = '';
    q.choices.forEach((choice, idx) => {
      const div = document.createElement('div');
      div.className = 'choice';
      div.textContent = choice;
      
      // Show if this choice was previously selected
      if (selectedAnswers[q.id] === idx) {
        div.classList.add('selected');
      }
      
      div.addEventListener('click', () => handleChoiceClick(idx, div, q));
      choicesEl.appendChild(div);
    });
    updateProgress();
  }
  
  function handleChoiceClick(choiceIndex, choiceElement, question) {
    // Prevent multiple clicks during animation
    if (isAdvancing) return;
    isAdvancing = true;
    
    // Cancel typing animation
    cancelTyping();
    questionText.classList.remove('typing');
    
    // Disable all choices
    choicesEl.classList.add('disabled');
    
    // Register the answer
    selectedAnswers[question.id] = choiceIndex;
    
    // Add highlight animation
    choiceElement.classList.add('selected-highlight');
    
    // Auto-advance after 1 second
    setTimeout(() => {
      choiceElement.classList.remove('selected-highlight');
      
      if (currentIndex < questions.length - 1) {
        currentIndex += 1;
        renderQuestion();
      } else {
        // Move to coding round
        showScreen('screen-code');
        renderCoding();
        currentIndex += 1;
        updateProgress();
      }
    }, 1000);
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
    
    // Position cursor on line 3 with proper indentation for function body
    setTimeout(() => {
      // Add a new line with proper indentation and position cursor there
      const currentValue = codeEditorCM.getValue();
      const newValue = currentValue + '    '; // Add 4 spaces for indentation
      codeEditorCM.setValue(newValue);
      codeEditorCM.setCursor(2, 4); // Line 3 (0-indexed), column 4 (after 4 spaces)
      codeEditorCM.focus();
    }, 100);
    
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
        // Cancel any ongoing typing or animations
        cancelTyping();
        isAdvancing = false;
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
    const cfgRes = await fetch(`${API_BASE}/api/config`);
    config = await cfgRes.json();
    updateProgress();
  }

  async function loadSessionQuestions() {
    if (!sessionId) return;
    const qRes = await fetch(`${API_BASE}/api/questions?session_id=${sessionId}`);
    questions = await qRes.json();
  }

  async function fetchCoding() {
    const res = await fetch(`${API_BASE}/api/coding`);
    if (res.ok) coding = await res.json();
  }

  startBtn.addEventListener('click', async () => {
    console.log('Start button clicked');
    const name = nameInput.value.trim();
    if (!name) { 
      nameValidation.style.display = 'block';
      nameInput.focus();
      return; 
    }
    // Hide validation message if name is entered
    nameValidation.style.display = 'none';
    console.log('Making API call to /api/start with name:', name);
    try {
      const res = await fetch(`${API_BASE}/api/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      console.log('Start API response status:', res.status);
      const data = await res.json();
      console.log('Start API response data:', data);
      sessionId = data.session_id;

      // Load session-specific questions
      console.log('Loading session questions...');
      await loadSessionQuestions();
      console.log('Questions loaded:', questions.length);

      // Track session start time
      sessionStartTime = Date.now();

      // Prepare quiz
      currentIndex = 0;
      updateProgress();
      console.log('Showing quiz screen...');
      showScreen('screen-quiz');
      
      // Small delay to ensure screen is visible before starting typewriter
      setTimeout(() => {
        renderQuestion();
      }, 50);

      startTimer(config?.duration_minutes || 45);

      // Preload coding info
      await fetchCoding();
    } catch (error) {
      console.error('Error in start button handler:', error);
      alert('Error starting the test: ' + error.message);
    }
  });

  // nextBtn removed - auto-advance on answer selection
  async function submitResults(name, responses, score) {
    await fetch("/api/submit_result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, responses, score })
    });
  }
  

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
    const res = await fetch(`${API_BASE}/api/submit`, {
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
      const response = await fetch(`${API_BASE}/api/test-code`, {
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

  // Hide validation message when user starts typing in name input
  nameInput.addEventListener('input', () => {
    if (nameInput.value.trim()) {
      nameValidation.style.display = 'none';
    }
  });

  // Initialize screen
  init().catch(err => console.error(err));
})();
