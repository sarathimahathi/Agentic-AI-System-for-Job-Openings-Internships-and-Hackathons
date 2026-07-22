// ===== SUPABASE CONFIG =====
const SUPABASE_URL = 'https://opzzzwceeydllodemucd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KV4otsvBhkNRK4bgKHqKvg_gYe79yXV';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== FLASK BACKEND CONFIG =====
const FLASK_API_URL = 'http://localhost:5000/api/analyze';

// ===== PDF PARSER CONFIG =====
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ===== TEXT PRE-PROCESSING: Header Detection =====
const RESUME_HEADER_PATTERN = /^(?:EXPERIENCE|WORK\s+EXPERIENCE|EMPLOYMENT\s+HISTORY|EDUCATION|SKILLS|TECHNICAL\s+SKILLS|PROJECTS|CERTIFICATIONS|ACHIEVEMENTS|SUMMARY|PROFESSIONAL\s+SUMMARY|OBJECTIVE|LANGUAGES|INTERESTS|REFERENCES|CONTACT|PERSONAL\s+DETAILS|AWARDS|PUBLICATIONS|VOLUNTEER\s+EXPERIENCE|LINKS|PORTFOLIO)\s*$/gim;

function preprocessText(rawText) {
  // Collapse runs of whitespace within lines, then normalise line breaks
  let text = rawText.replace(/\r\n?/g, '\n');
  // Insert double newline before recognised section headers
  text = text.replace(RESUME_HEADER_PATTERN, '\n\n$&');
  // Collapse 3+ consecutive newlines into exactly 2
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// ===== RESUME PARSING FUNCTIONS =====
async function parsePDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    // Build page text preserving approximate structure
    let lastY = null;
    let pageLines = [];
    let currentLine = [];
    for (const item of textContent.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
        pageLines.push(currentLine.join(' '));
        currentLine = [];
      }
      currentLine.push(item.str);
      lastY = item.transform[5];
    }
    if (currentLine.length) pageLines.push(currentLine.join(' '));
    pageTexts.push(pageLines.join('\n'));
  }

  const raw = pageTexts.join('\n\n');
  return preprocessText(raw);
}

async function parseDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return preprocessText(result.value);
}

function extractSkills(text) {
  const skillPatterns = [
    'javascript', 'typescript', 'python', 'java', 'c\\+\\+', 'c#', 'ruby', 'go', 'rust', 'swift', 'kotlin',
    'react', 'angular', 'vue', 'node\\.js', 'express', 'django', 'flask', 'fastapi', 'spring',
    'html', 'css', 'sass', 'less', 'tailwind',
    'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch',
    'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'jenkins', 'ci/cd',
    'git', 'github', 'gitlab', 'bitbucket',
    'machine learning', 'deep learning', 'tensorflow', 'pytorch', 'keras', 'scikit-learn',
    'nlp', 'computer vision', 'data science', 'data analysis', 'data engineering',
    'agile', 'scrum', 'jira', 'confluence',
    'rest api', 'graphql', 'microservices', 'serverless',
    'linux', 'bash', 'shell scripting',
    'figma', 'sketch', 'adobe xd', 'ui/ux'
  ];
  
  const lowerText = text.toLowerCase();
  const foundSkills = [];
  
  skillPatterns.forEach(skill => {
    const regex = new RegExp(skill, 'gi');
    if (regex.test(lowerText)) {
      foundSkills.push(skill.replace(/\\/, ''));
    }
  });
  
  return [...new Set(foundSkills)];
}

function extractExperience(text) {
  const patterns = [
    /(\d+)\+?\s*years?\s*(?:of\s+)?experience/gi,
    /experience:\s*(\d+)\+?\s*years?/gi,
    /(\d+)\+?\s*yr/gi
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = match[0].match(/\d+/);
      if (num && parseInt(num[0]) <= 30) return parseInt(num[0]);
    }
  }
  return null;
}

function extractEducation(text) {
  const patterns = [
    /bachelor'?s?\s*(?:degree)?/gi,
    /b\.?s\.?/gi,
    /master'?s?\s*(?:degree)?/gi,
    /m\.?s\.?/gi,
    /ph\.?d\.?/gi,
    /mba/gi,
    /b\.?tech/gi,
    /m\.?tech/gi,
    /bca/gi,
    /mca/gi
  ];
  
  const degrees = [];
  patterns.forEach(pattern => {
    const match = text.match(pattern);
    if (match) degrees.push(match[0]);
  });
  
  return degrees.length > 0 ? degrees.join(', ') : null;
}

function extractSummary(text, filename) {
  const lines = text.split('\n').filter(l => l.trim().length > 10);
  const firstLines = lines.slice(0, 3).join(' ').trim();
  return firstLines.substring(0, 500) || `Resume: ${filename}`;
}

// ===== VIEW MANAGEMENT =====
function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.nav-link[data-view="${view}"]`).classList.add('active');

  window.scrollTo(0, 0);
}

// ===== THEME TOGGLE =====
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  document.getElementById('themeIcon').className = next === 'dark' ? 'fas fa-moon icon' : 'fas fa-sun icon';
  document.getElementById('themeLabel').textContent = next === 'dark' ? 'Dark' : 'Light';
}

// ===== LIVE METRICS ANIMATION =====
function animateMetric(id, target, prefix = '', suffix = '') {
  const el = document.getElementById(id);
  if (!el) return;
  let current = 0;
  const step = Math.ceil(target / 40);
  const interval = setInterval(() => {
    current += step;
    if (current >= target) { current = target; clearInterval(interval); }
    const formatted = current.toLocaleString();
    const existing = el.querySelector('.trend');
    const trendHTML = existing ? existing.outerHTML : '';
    el.innerHTML = prefix + formatted + suffix + ' ' + trendHTML;
  }, 30);
}

// ===== POPULATE OPPORTUNITY FEED =====
const opportunities = [
  { source: 'linkedin', icon: 'fab fa-linkedin', title: 'Senior Full-Stack Engineer', company: 'Stripe', location: 'Remote (US)', salary: '$150k - $200k', time: '2m ago' },
  { source: 'naukri', icon: 'fas fa-briefcase', title: 'ML Research Intern', company: 'Google Research India', location: 'Bangalore', salary: '₹80k/mo', time: '5m ago' },
  { source: 'indeed', icon: 'fas fa-search', title: 'DevOps Engineer', company: 'GitLab', location: 'Remote (Global)', salary: '$130k - $170k', time: '8m ago' },
  { source: 'glassdoor', icon: 'fas fa-star', title: 'Backend Engineer (Go/Rust)', company: 'Cloudflare', location: 'Austin, TX', salary: '$140k - $180k', time: '12m ago' },
  { source: 'linkedin', icon: 'fab fa-linkedin', title: 'Data Scientist', company: 'Netflix', location: 'Los Gatos, CA', salary: '$160k - $220k', time: '15m ago' },
  { source: 'naukri', icon: 'fas fa-briefcase', title: 'Frontend Developer (React)', company: 'Razorpay', location: 'Bangalore', salary: '₹45k/mo', time: '18m ago' },
  { source: 'indeed', icon: 'fas fa-search', title: 'Platform Engineer', company: 'HashiCorp', location: 'Remote', salary: '$145k - $185k', time: '22m ago' },
  { source: 'glassdoor', icon: 'fas fa-star', title: 'AI/ML Engineer', company: 'Anthropic', location: 'San Francisco', salary: '$180k - $250k', time: '25m ago' },
];

function renderOpportunities() {
  const container = document.getElementById('oppFeed');
  container.innerHTML = opportunities.map(o => `
    <div class="opportunity-card">
      <div class="opp-source-icon ${o.source}"><i class="${o.icon}"></i></div>
      <div class="opp-info">
        <h4>${o.title}</h4>
        <div class="opp-company">${o.company}</div>
        <div class="opp-meta">
          <span><i class="fas fa-location-dot"></i> ${o.location}</span>
          <span><i class="fas fa-money-bill"></i> ${o.salary}</span>
        </div>
      </div>
      <div class="opp-time">${o.time}</div>
    </div>
  `).join('');
}

// ===== POPULATE JOB FEED =====
const jobs = [
  { title: 'Senior Backend Engineer', company: 'Stripe', tags: ['Python', 'Go', 'Microservices'], salary: '$150k-$200k' },
  { title: 'Machine Learning Engineer', company: 'OpenAI', tags: ['PyTorch', 'Transformers', 'CUDA'], salary: '$170k-$240k' },
  { title: 'Full-Stack Developer', company: 'Vercel', tags: ['Next.js', 'TypeScript', 'Edge Functions'], salary: '$120k-$160k' },
  { title: 'DevOps / SRE Engineer', company: 'Datadog', tags: ['Kubernetes', 'Terraform', 'Go'], salary: '$140k-$180k' },
  { title: 'Data Engineer', company: 'Databricks', tags: ['Spark', 'SQL', 'Python'], salary: '$135k-$175k' },
  { title: 'Frontend Engineer', company: 'Figma', tags: ['React', 'WebGL', 'TypeScript'], salary: '$130k-$170k' },
];

function renderJobs() {
  const container = document.getElementById('jobFeed');
  container.innerHTML = jobs.map(j => `
    <div class="job-card">
      <div class="job-card-top">
        <div>
          <h4>${j.title}</h4>
          <div class="job-company">${j.company} &bull; ${j.salary}</div>
        </div>
      </div>
      <div class="job-tags">${j.tags.map(t => `<span class="job-tag">${t}</span>`).join('')}</div>
      <div class="job-card-actions">
        <button class="btn-outline"><i class="fas fa-external-link-alt"></i> View on Platform</button>
        <button class="btn-auto-apply"><i class="fas fa-bolt"></i> Agentic Auto-Apply</button>
      </div>
    </div>
  `).join('');
}

// ===== POPULATE GRANTS =====
const grants = [
  { title: 'India Startup Fund - Tech for Good', org: 'DPIIT, Government of India', desc: 'Grants up to ₹50L for technology startups solving infrastructure and housing challenges in Tier 2-3 cities.', amount: 'Up to ₹50,00,000', match: 92, badge: 'high' },
  { title: 'Global Housing Innovation Challenge', org: 'UN-Habitat', desc: 'Funding for AI-driven construction and housing solutions targeting affordability in developing markets.', amount: '$250,000', match: 87, badge: 'high' },
  { title: 'AWS Impact Accelerator', org: 'Amazon Web Services', desc: 'Up to $100K in AWS credits plus mentorship for startups using cloud-native architectures for social good.', amount: '$100K Credits', match: 78, badge: 'medium' },
  { title: 'Microsoft for Startups Founders Hub', org: 'Microsoft', desc: 'Free Azure credits, GitHub access, and AI services for early-stage startups. No equity required.', amount: '$150K Credits', match: 74, badge: 'medium' },
  { title: 'Y Combinator Summer Batch', org: 'Y Combinator', desc: 'Standard $500K safe investment for early-stage startups. Strong focus on AI and infrastructure plays.', amount: '$500,000', match: 68, badge: 'medium' },
  { title: 'Sequoia Scouts Program', org: 'Sequoia Capital', desc: 'Micro-investments from Sequoia scouts for pre-seed and seed stage startups with strong technical founders.', amount: '$50K - $200K', match: 52, badge: 'low' },
  { title: 'NSF SBIR Phase I', org: 'National Science Foundation', desc: 'Small Business Innovation Research grants for deep-tech and scientific startups in the US.', amount: '$275,000', match: 45, badge: 'low' },
];

function renderGrants() {
  const container = document.getElementById('grantList');
  container.innerHTML = grants.map(g => `
    <div class="grant-card">
      <div class="grant-info">
        <h4>${g.title}</h4>
        <div class="grant-org">${g.org}</div>
        <div class="grant-desc">${g.desc}</div>
        <div class="grant-amount">${g.amount}</div>
      </div>
      <div class="grant-match">
        <div class="match-badge ${g.badge}">${g.match}%</div>
        <button class="btn-draft"><i class="fas fa-file-pen"></i> Draft Proposal</button>
      </div>
    </div>
  `).join('');
}

// ===== BROADCAST ALERT =====
function broadcastAlert() {
  const group = document.getElementById('broadcastGroup').value;
  if (!group) { alert('Please select a target student group first.'); return; }
  const count = group === 'all' ? '312' : group === 'cs-seniors' ? '84' : '45-60';
  alert(`Broadcast sent successfully to ${count} students via WhatsApp!`);
}

// ===== MATCH GRANTS (re-render with animation) =====
function matchGrants() {
  const container = document.getElementById('grantList');
  container.style.opacity = '0.5';
  setTimeout(() => { container.style.opacity = '1'; }, 800);
}

// ===== MOCK INTERVIEW =====
function openMockInterview(company) {
  document.getElementById('mockCompany').textContent = company;
  document.getElementById('chatCompany').textContent = company;
  document.getElementById('mockModal').classList.add('active');
  document.getElementById('chatMessages').innerHTML = `
    <div class="chat-msg ai">Welcome to the interview prep simulator! I'll be conducting a mock interview for <strong>${company}</strong>. Let's start with a behavioral question: Tell me about a time you had to deal with a difficult stakeholder.</div>
  `;
}

function closeMockInterview() {
  document.getElementById('mockModal').classList.remove('active');
}

const aiResponses = [
  "Great answer! Now let's move to a technical question. How would you design a scalable URL shortener service? Walk me through the architecture.",
  "Interesting approach. Let me push deeper — how would you handle 100M daily active users with 1B URL redirections per day? What caching strategies would you use?",
  "Good thinking on the caching layer. Now, tell me about a project where you had to make a critical technical decision under time pressure. What was the outcome?",
  "I appreciate the depth. For our next question: given an array of integers, find two numbers that add up to a target. Can you walk me through your approach?",
  "Solid solution. What's the time and space complexity? Can you optimize the space usage further?",
  "Nice work! Let's do one more behavioral: Describe a time you mentored a junior engineer. How did you adapt your communication style?",
  "Excellent. At the company, we value leadership principles deeply. How do you handle ambiguity in project requirements?"
];

let aiIdx = 0;

function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;

  const container = document.getElementById('chatMessages');
  container.innerHTML += `<div class="chat-msg user">${msg}</div>`;
  input.value = '';

  setTimeout(() => {
    const response = aiResponses[aiIdx % aiResponses.length];
    aiIdx++;
    container.innerHTML += `<div class="chat-msg ai">${response}</div>`;
    container.scrollTop = container.scrollHeight;
  }, 1000);
}

// ===== GLOBAL STATE =====
let attachedFile = null;

// ===== FILE ATTACH (Gmail-like, no processing) =====
function handleResumeUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  attachedFile = file;

  document.getElementById('uploadPlaceholder').style.display = 'none';
  document.getElementById('uploadPreview').style.display = 'flex';
  document.getElementById('attachedFileName').textContent = file.name;
}

function removeAttachedFile() {
  attachedFile = null;
  document.getElementById('resumeInput').value = '';
  document.getElementById('uploadPlaceholder').style.display = 'block';
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('atsResultsSection').style.display = 'none';
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  renderOpportunities();
  renderJobs();
  renderGrants();
  animateMetric('metric-jobs', 1247);
  animateMetric('metric-applied', 386);
  animateMetric('metric-groups', 24);

  // File input change
  document.getElementById('resumeInput').addEventListener('change', handleResumeUpload);

  // Drag and drop
  const zone = document.getElementById('uploadZone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--primary)'; zone.style.background = 'var(--primary-light)'; });
  zone.addEventListener('dragleave', (e) => { e.preventDefault(); zone.style.borderColor = ''; zone.style.background = ''; });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.style.borderColor = '';
    zone.style.background = '';
    const file = e.dataTransfer.files[0];
    if (file) {
      attachedFile = file;
      document.getElementById('uploadPlaceholder').style.display = 'none';
      document.getElementById('uploadPreview').style.display = 'flex';
      document.getElementById('attachedFileName').textContent = file.name;
    }
  });
});

// ===== ANALYZE (Flask backend — multi-pass Ollama pipeline) =====
async function analyzeATS() {
  if (!attachedFile) { alert('Please attach a resume first.'); return; }

  const targetRole = document.getElementById('targetRoleInput').value.trim();
  const jobDesc = document.getElementById('jobDescriptionInput').value.trim();
  if (!targetRole && !jobDesc) { alert('Please enter a target job role or job description.'); return; }

  const analyzeBtn = document.getElementById('analyzeAtsBtn');
  const status = document.getElementById('composeStatus');
  const resultsSection = document.getElementById('atsResultsSection');
  const atsScore = document.getElementById('atsScore');
  const atsArc = document.getElementById('atsArc');
  const suggestionsDiv = document.getElementById('atsSuggestions');
  const reportDiv = document.getElementById('atsReport');

  // Show loading
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
  status.style.display = 'inline';
  status.textContent = 'Reading resume...';
  resultsSection.style.display = 'none';

  try {
    // Step 1: Parse the file client-side (PDF/DOCX → text)
    let extractedText = '';
    const fileExt = attachedFile.name.split('.').pop().toLowerCase();
    if (fileExt === 'pdf') {
      extractedText = await parsePDF(attachedFile);
    } else if (fileExt === 'docx') {
      extractedText = await parseDOCX(attachedFile);
    } else {
      extractedText = await attachedFile.text();
    }

    // Step 2: Send to Flask backend (3-pass Ollama pipeline + deterministic scoring)
    status.textContent = 'Pass 1/3 — Extracting resume data...';

    const backendPayload = {
      resume_text: extractedText,
      target_role: targetRole || null,
      job_description: jobDesc || null,
    };

    status.textContent = 'Running multi-pass AI pipeline on local Ollama...';

    const response = await fetch(FLASK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendPayload),
    });

    const result = await response.json();

    if (!response.ok) {
      const errMsg = result.error || `Backend returned HTTP ${response.status}`;
      throw new Error(errMsg);
    }

    const resumeData = result.resume_data || {};
    const jdData = result.jd_data || {};
    const evaluation = result.evaluation || {};
    const score = result.score || 0;
    const breakdown = result.score_breakdown || {};

    // Step 3: Upload file to Supabase Storage
    status.textContent = 'Uploading to Supabase...';
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `resumes/${fileName}`;

    const { error: uploadError } = await sbClient.storage
      .from('resumes')
      .upload(filePath, attachedFile);
    if (uploadError) throw uploadError;

    const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/resumes/${filePath}`;

    // Step 4: Store everything in unified table
    status.textContent = 'Storing analysis in database...';
    const { error: dbError } = await sbClient
      .from('resume_analyses')
      .insert({
        file_name: attachedFile.name,
        file_url: fileUrl,
        file_size: attachedFile.size,
        file_type: fileExt,
        extracted_text: extractedText.substring(0, 10000),
        summary: resumeData.summary || '',
        skills: resumeData.skills || [],
        experience_years: resumeData.experience_years || null,
        education: resumeData.education || '',
        metadata: {
          name: resumeData.name || '',
          email: resumeData.email || '',
          phone: resumeData.phone || '',
          location: resumeData.location || '',
          certifications: resumeData.certifications || [],
          languages: resumeData.languages || [],
          experience_entries: resumeData.experience_entries || [],
        },
        target_role: targetRole || null,
        job_description: jobDesc || null,
        jd_mandatory_skills: jdData.mandatory_skills || [],
        jd_nice_to_have_skills: jdData.nice_to_have_skills || [],
        jd_minimum_years_experience: jdData.minimum_years_experience || null,
        jd_role_title: jdData.role_title || '',
        jd_summary: jdData.summary || '',
        candidate_name: resumeData.name || null,
        candidate_email: resumeData.email || null,
        ats_score: score,
        mandatory_score: breakdown.mandatory_skills?.percentage || 0,
        experience_score: breakdown.experience?.percentage || 0,
        nice_to_have_score: breakdown.nice_to_have?.percentage || 0,
        skills_matched: evaluation.matched_skills || [],
        skills_missing: evaluation.missing_skills || [],
        nice_to_have_matched: evaluation.nice_to_have_matched || [],
        nice_to_have_missing: evaluation.nice_to_have_missing || [],
        meets_experience: evaluation.meets_experience_requirement || false,
        strengths: evaluation.strengths || [],
        weaknesses: evaluation.weaknesses || [],
        recommendations: evaluation.recommendations || [],
        verdict: evaluation.verdict || '',
        parsed_with: 'ollama-llama3.1-multi-pass',
        user_id: 'anonymous',
      });
    if (dbError) throw dbError;

    // Step 5: Render results
    status.textContent = '';
    status.style.display = 'none';
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Analyze & Store';

    resultsSection.style.display = 'block';

    const clampedScore = Math.min(100, Math.max(0, score));
    const offset = 314 - (314 * clampedScore / 100);
    atsArc.style.strokeDashoffset = offset;
    atsScore.textContent = `${clampedScore}%`;

    if (clampedScore >= 75) { atsArc.style.stroke = 'var(--green)'; atsScore.style.color = 'var(--green)'; }
    else if (clampedScore >= 50) { atsArc.style.stroke = 'var(--amber)'; atsScore.style.color = 'var(--amber)'; }
    else { atsArc.style.stroke = 'var(--red)'; atsScore.style.color = 'var(--red)'; }

    suggestionsDiv.innerHTML = `<h4>Optimization Suggestions</h4>
      ${(evaluation.recommendations || []).map(r => `<div class="suggestion-item"><span class="si-icon"><i class="fas fa-lightbulb"></i></span><span>${r}</span></div>`).join('')}
      ${(evaluation.weaknesses || []).map(w => `<div class="suggestion-item"><span class="si-icon"><i class="fas fa-exclamation-triangle"></i></span><span>${w}</span></div>`).join('')}`;

    // Score breakdown panel
    const b = breakdown;
    reportDiv.innerHTML = `<div style="font-size:13px;line-height:1.8;">
      <div style="margin-bottom:12px;"><strong>Verdict:</strong> ${evaluation.verdict || 'N/A'}</div>

      <div style="margin-bottom:16px;padding:12px;background:var(--bg-secondary);border-radius:8px;">
        <strong style="display:block;margin-bottom:8px;"><i class="fas fa-chart-pie" style="color:var(--primary);margin-right:4px;"></i> Score Breakdown</strong>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:120px;">
            <div style="font-size:11px;color:var(--text-muted);">Mandatory Skills (40%)</div>
            <div style="font-weight:600;">${b.mandatory_skills ? b.mandatory_skills.matched + '/' + b.mandatory_skills.total : '—'} <span style="font-size:11px;color:var(--text-muted);">(${b.mandatory_skills ? b.mandatory_skills.percentage : 0}%)</span></div>
          </div>
          <div style="flex:1;min-width:120px;">
            <div style="font-size:11px;color:var(--text-muted);">Experience (30%)</div>
            <div style="font-weight:600;">${b.experience ? (b.experience.meets_requirement ? 'Meets' : 'Below') : '—'} <span style="font-size:11px;color:var(--text-muted);">(${b.experience ? b.experience.percentage : 0}%)</span></div>
          </div>
          <div style="flex:1;min-width:120px;">
            <div style="font-size:11px;color:var(--text-muted);">Nice-to-Haves (30%)</div>
            <div style="font-weight:600;">${b.nice_to_have ? b.nice_to_have.matched + '/' + b.nice_to_have.total : '—'} <span style="font-size:11px;color:var(--text-muted);">(${b.nice_to_have ? b.nice_to_have.percentage : 0}%)</span></div>
          </div>
        </div>
      </div>

      ${jdData.role_title ? `<div style="margin-bottom:12px;"><strong>Target Role:</strong> ${jdData.role_title}</div>` : ''}
      ${jdData.summary ? `<div style="margin-bottom:12px;"><strong>JD Summary:</strong> <span style="color:var(--text-secondary);">${jdData.summary}</span></div>` : ''}

      <div style="margin-bottom:8px;"><strong style="color:var(--green);">Matched Skills (${evaluation.matched_skills ? evaluation.matched_skills.length : 0}):</strong></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        ${(evaluation.matched_skills || []).map(s => `<span class="skill-tag" style="background:var(--green-light);color:var(--green);">${s}</span>`).join('')}
      </div>
      <div style="margin-bottom:8px;"><strong style="color:var(--red);">Missing Skills (${evaluation.missing_skills ? evaluation.missing_skills.length : 0}):</strong></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        ${(evaluation.missing_skills || []).map(s => `<span class="skill-tag" style="background:var(--red-light);color:var(--red);">${s}</span>`).join('')}
      </div>
      ${(evaluation.nice_to_have_matched && evaluation.nice_to_have_matched.length > 0) ? `
        <div style="margin-bottom:8px;"><strong style="color:var(--teal);">Nice-to-Have Matched:</strong></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
          ${evaluation.nice_to_have_matched.map(s => `<span class="skill-tag" style="background:var(--primary-light);color:var(--primary);">${s}</span>`).join('')}
        </div>
      ` : ''}
      <div style="margin-bottom:8px;"><strong>Strengths:</strong></div>
      ${(evaluation.strengths || []).map(s => `<div style="font-size:12px;color:var(--green);margin-bottom:4px;">&#10003; ${s}</div>`).join('')}
    </div>`;

  } catch (err) {
    console.error('Analyze error:', err);
    let userMessage = err.message;
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      userMessage = 'Cannot reach Flask backend at localhost:5000. Make sure the Python server is running: python app.py';
    } else if (err.message.includes('ollama') || err.message.includes('Ollama')) {
      userMessage = 'Ollama is unreachable. Make sure Ollama is running: ollama serve';
    }
    status.style.display = 'inline';
    status.textContent = 'Error: ' + userMessage;
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Analyze & Store';
  }
}

// ===== RAG SEARCH FUNCTIONALITY =====
async function searchResumes(query) {
  const resultsContainer = document.getElementById('searchResults');
  if (!query || query.trim().length === 0) {
    resultsContainer.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Type to search resumes...</p>';
    return;
  }

  resultsContainer.innerHTML = '<p style="color:var(--text-muted);font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Searching...</p>';

  try {
    // Search using text search function
    const { data, error } = await sbClient.rpc('search_resumes_by_text', {
      search_query: query,
      match_count: 10
    });

    if (error) {
      // Fallback to basic query if function doesn't exist
      const { data: fallbackData, error: fallbackError } = await sbClient
        .from('resumes')
        .select('*')
        .or(`file_name.ilike.%${query}%,extracted_text.ilike.%${query}%,summary.ilike.%${query}%`)
        .order('upload_date', { ascending: false })
        .limit(10);

      if (fallbackError) throw fallbackError;
      renderSearchResults(fallbackData, query);
      return;
    }

    renderSearchResults(data, query);
  } catch (err) {
    resultsContainer.innerHTML = `<p style="color:var(--red);font-size:13px;">Search error: ${err.message}</p>`;
  }
}

function renderSearchResults(results, query) {
  const resultsContainer = document.getElementById('searchResults');
  
  if (!results || results.length === 0) {
    resultsContainer.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No resumes found for "${query}"</p>`;
    return;
  }

  resultsContainer.innerHTML = results.map(r => `
    <div class="search-result-card">
      <div class="search-result-header">
        <i class="fas fa-file-alt" style="color:var(--primary);margin-right:8px;"></i>
        <a href="${r.file_url}" target="_blank" style="color:var(--primary);text-decoration:none;font-weight:600;font-size:14px;">${r.file_name}</a>
      </div>
      <div class="search-result-meta">
        <span><i class="fas fa-calendar" style="margin-right:4px;"></i>${new Date(r.upload_date).toLocaleDateString()}</span>
        ${r.file_size ? `<span><i class="fas fa-file" style="margin-right:4px;"></i>${(r.file_size / 1024).toFixed(1)} KB</span>` : ''}
      </div>
      ${r.summary ? `<p class="search-result-summary">${r.summary}</p>` : ''}
      ${r.skills && r.skills.length > 0 ? `
        <div class="search-result-skills">
          ${r.skills.map(s => `<span class="skill-tag">${s}</span>`).join('')}
        </div>
      ` : ''}
      ${r.similarity ? `<div class="search-result-score">Match: ${(r.similarity * 100).toFixed(1)}%</div>` : ''}
    </div>
  `).join('');
}

async function getAllResumes() {
  const { data, error } = await sbClient
    .from('resumes')
    .select('*')
    .order('upload_date', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data;
}

async function getResumeById(id) {
  const { data, error } = await sbClient
    .from('resumes')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

document.getElementById('mockModal').addEventListener('click', function(e) {
  if (e.target === this) closeMockInterview();
});
