// ===== SUPABASE CONFIG =====
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== GROQ CONFIG (Free, very fast) =====
const GROQ_API_KEY = 'YOUR_GROQ_API_KEY'; // Get free key at console.groq.com
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ===== PDF PARSER CONFIG =====
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ===== AI RESUME PARSING (Groq) =====
async function parseResumeWithAI(text, filename) {
  if (!GROQ_API_KEY) {
    throw new Error('Groq API key not set. Get free key at console.groq.com');
  }

  const prompt = `Extract structured data from this resume. Return ONLY valid JSON:
{
  "name": "full name",
  "email": "email address",
  "phone": "phone number",
  "location": "city, country",
  "summary": "2-3 sentence professional summary",
  "skills": ["skill1", "skill2"],
  "experience_years": number,
  "education": "highest degree and institution",
  "certifications": ["cert1"],
  "languages": ["lang1"]
}

Resume text:
${text.substring(0, 4000)}

Return ONLY the JSON, no other text.`;

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: 'You are a resume parser. Return valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 1500
    })
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error?.message || `HTTP ${response.status}`);
  }

  const content = data.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error('No JSON found in AI response');
}

// ===== RESUME PARSING FUNCTIONS =====
async function parsePDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map(item => item.str).join(' ') + '\n';
  }
  
  return fullText;
}

async function parseDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
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

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  renderOpportunities();
  renderJobs();
  renderGrants();
  animateMetric('metric-jobs', 1247);
  animateMetric('metric-applied', 386);
  animateMetric('metric-groups', 24);

  // Resume upload handler
  const resumeInput = document.getElementById('resumeInput');
  const uploadZone = document.getElementById('uploadZone');

  resumeInput.addEventListener('change', handleResumeUpload);

  // Drag and drop support
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = 'var(--primary)';
    uploadZone.style.background = 'var(--primary-light)';
  });

  uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = '';
    uploadZone.style.background = '';
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = '';
    uploadZone.style.background = '';
    const file = e.dataTransfer.files[0];
    if (file) uploadToSupabase(file);
  });
});

// ===== RESUME UPLOAD TO SUPABASE =====
async function handleResumeUpload(e) {
  const file = e.target.files[0];
  if (file) uploadToSupabase(file);
}

async function uploadToSupabase(file) {
  const uploadZone = document.getElementById('uploadZone');
  const originalContent = uploadZone.innerHTML;

  uploadZone.innerHTML = `
    <div class="upload-icon"><i class="fas fa-spinner fa-spin"></i></div>
    <h4>AI Parsing Resume...</h4>
    <p>${file.name}</p>
  `;

  try {
    let extractedText = '';
    const fileExt = file.name.split('.').pop().toLowerCase();
    
    if (fileExt === 'pdf') {
      extractedText = await parsePDF(file);
    } else if (fileExt === 'docx') {
      extractedText = await parseDOCX(file);
    } else {
      extractedText = await file.text();
    }

    const aiData = await parseResumeWithAI(extractedText, file.name);

    const skills = aiData.skills || [];
    const experienceYears = aiData.experience_years || null;
    const education = aiData.education || '';
    const summary = aiData.summary || '';
    const name = aiData.name || file.name.split('.')[0];
    const email = aiData.email || '';
    const phone = aiData.phone || '';
    const location = aiData.location || '';
    const certifications = aiData.certifications || [];
    const languages = aiData.languages || [];

    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `resumes/${fileName}`;

    const { data, error } = await sbClient.storage
      .from('resumes')
      .upload(filePath, file);

    if (error) throw error;

    const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/resumes/${filePath}`;

    const { error: dbError } = await sbClient
      .from('resumes')
      .insert({
        file_name: file.name,
        file_url: fileUrl,
        file_size: file.size,
        file_type: fileExt,
        extracted_text: extractedText.substring(0, 10000),
        summary: summary,
        skills: skills,
        experience_years: experienceYears,
        education: education,
        user_id: 'anonymous',
        metadata: { 
          originalName: file.name, 
          uploadSource: 'web',
          parsedAt: new Date().toISOString(),
          parsedWith: 'groq-ai',
          name: name,
          email: email,
          phone: phone,
          location: location,
          certifications: certifications,
          languages: languages
        }
      });

    if (dbError) throw dbError;

    uploadZone.innerHTML = `
      <div class="upload-icon" style="color:var(--green);"><i class="fas fa-check-circle"></i></div>
      <h4>AI Parsed & Uploaded!</h4>
      <p>${file.name}</p>
      <div style="margin-top:12px;font-size:12px;color:var(--text-secondary);text-align:left;">
        <div style="color:var(--primary);font-weight:600;margin-bottom:4px;">Parsed with: Groq AI</div>
        ${name ? `<div><strong>Name:</strong> ${name}</div>` : ''}
        ${email ? `<div><strong>Email:</strong> ${email}</div>` : ''}
        ${phone ? `<div><strong>Phone:</strong> ${phone}</div>` : ''}
        ${location ? `<div><strong>Location:</strong> ${location}</div>` : ''}
        ${skills.length > 0 ? `<div><strong>Skills:</strong> ${skills.slice(0, 8).join(', ')}</div>` : ''}
        ${experienceYears ? `<div><strong>Experience:</strong> ${experienceYears} years</div>` : ''}
        ${education ? `<div><strong>Education:</strong> ${education}</div>` : ''}
        ${languages.length > 0 ? `<div><strong>Languages:</strong> ${languages.join(', ')}</div>` : ''}
      </div>
    `;
    
    uploadZone.onclick = () => {
      uploadZone.innerHTML = originalContent;
      uploadZone.onclick = () => document.getElementById('resumeInput').click();
      document.getElementById('resumeInput').addEventListener('change', handleResumeUpload);
    };

  } catch (err) {
    console.error('Upload error:', err);
    uploadZone.innerHTML = `
      <div class="upload-icon" style="color:var(--red);"><i class="fas fa-exclamation-circle"></i></div>
      <h4>AI Parsing Failed</h4>
      <p style="font-size:13px;">${err.message}</p>
      <p style="margin-top:8px;font-size:12px;color:var(--text-muted);">Check Console (F12) for details. Click to retry.</p>
    `;
    uploadZone.onclick = () => {
      uploadZone.innerHTML = originalContent;
      uploadZone.onclick = () => document.getElementById('resumeInput').click();
      document.getElementById('resumeInput').addEventListener('change', handleResumeUpload);
    };
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
