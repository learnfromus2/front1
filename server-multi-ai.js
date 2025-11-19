require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');
const puppeteer = require('puppeteer');
const { chromium } = require('playwright');
const fs = require('fs').promises;
const app = express();

// Find available port
const findAvailablePort = (startPort) => {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();

    server.listen(startPort, () => {
      server.close(() => {
        resolve(startPort);
      });
    });

    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
};

// Initialize server with dynamic port
const initializeServer = async () => {
  const PORT = await findAvailablePort(3000);

  // MongoDB Connection
  const MONGODB_URI = process.env.MONGODB_URI ;

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Create demo users after connection
    setTimeout(createDemoUsers, 2000);
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }

  // MongoDB Schemas and Models
  const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['student', 'teacher', 'admin'], default: 'student' },
    email: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now }
  });

  userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
  });

  userSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
  };

  const questionSchema = new mongoose.Schema({
    examType: { type: String, enum: ['jee', 'neet'], required: true },
    subject: { type: String, required: true },
    class: { type: String, required: true },
    chapter: { type: String, required: true },
    text: { type: String, required: true },
    options: [{ type: String, required: true }],
    answer: { type: String, required: true },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], required: true },
    solution: { type: String, required: true },
    explanation: { type: String },
    // Enhanced features
    enhanced: { type: Boolean, default: false },
    language: { type: String, enum: ['en', 'gu'], default: 'en' }, // Question language
    tags: [{ type: String }], // Array of tags
    hints: { type: String }, // Hints for students
    references: { type: String }, // Reference materials
    media: [{
      id: String,
      type: { type: String, enum: ['image', 'graph', 'chart'] },
      data: String, // Base64 encoded data
      name: String,
      description: String
    }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModified: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
  });

  const testSchema = new mongoose.Schema({
    title: { type: String, required: true },
    type: { type: String, enum: ['jee', 'neet'], required: true },
    subject: { type: String, required: true },
    class: { type: String, required: true },
    chapter: { type: String, required: true },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'mixed'], default: 'mixed' },
    duration: { type: Number, required: true },
    questionCount: { type: Number, required: true },
    questions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  });

  const testResultSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test' },
    mockTestId: { type: mongoose.Schema.Types.ObjectId, ref: 'MockTest' },
    testTitle: { type: String, required: true },
    testType: { type: String, enum: ['mock', 'practice', 'custom'], default: 'practice' },
    answers: { type: Map, of: String },
    score: { type: Number, required: true },
    totalMarks: { type: Number, required: true },
    maxMarks: { type: Number, required: true },
    totalQuestions: { type: Number, required: true },
    correct: { type: Number, required: true },
    incorrect: { type: Number, required: true },
    unanswered: { type: Number, required: true },
    percentage: { type: Number, required: true },
    timeSpent: { type: Number, required: true },
    hasNegativeMarking: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
  });

  const chapterSchema = new mongoose.Schema({
    examType: { type: String, enum: ['jee', 'neet'], required: true },
    subject: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String },
    icon: { type: String, default: 'fa-book' },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  });

  // Ensure unique chapters per exam type and subject
  chapterSchema.index({ examType: 1, subject: 1, name: 1 }, { unique: true });

  // Mock Test Schema
  const mockTestSchema = new mongoose.Schema({
    name: { type: String, required: true },
    examType: { type: String, enum: ['jee', 'neet'], required: true },
    duration: { type: Number, required: true }, // in minutes
    description: { type: String },
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    totalQuestions: { type: Number, required: true },
    marksPerQuestion: { type: Number, default: 4 }, // Marks awarded for each correct answer
    negativeMarking: { type: Boolean, default: true }, // Enable/disable negative marking
    negativeMarks: { type: Number, default: -1 }, // Marks deducted for wrong answer (25% of marksPerQuestion)
    totalMarks: { type: Number }, // Total marks for the test (totalQuestions * marksPerQuestion)
    createdBy: { type: String, required: true },
    isPublic: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
  });

  const User = mongoose.model('User', userSchema);
  const Question = mongoose.model('Question', questionSchema);
  const Test = mongoose.model('Test', testSchema);
  const TestResult = mongoose.model('TestResult', testResultSchema);
  const Chapter = mongoose.model('Chapter', chapterSchema);
  const MockTest = mongoose.model('MockTest', mockTestSchema);

  // Paper Configuration Schema (for saving paper settings without PDF)
  const paperConfigSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    paperName: { type: String, required: true },
    
    // School Details
    schoolName: { type: String, required: true },
    schoolLogo: { type: String }, // Base64 or URL
    
    // Paper Settings
    examType: { type: String, enum: ['jee', 'neet'], required: true },
    subject: { type: String, required: true },
    examDate: { type: Date, required: true },
    examTime: { type: Number, required: true }, // minutes
    totalMarks: { type: Number, required: true },
    watermark: { type: String },
    
    // Selected Questions (Just IDs - very small!)
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    
    // PDF Type Preference
    pdfType: { type: String, enum: ['paper', 'answers', 'solutions'], default: 'paper' },
    
    // Metadata
    createdAt: { type: Date, default: Date.now },
    lastGenerated: { type: Date, default: Date.now }
  });

  const PaperConfig = mongoose.model('PaperConfig', paperConfigSchema);

  // Generated PDF Schema (for tracking PDFs with auto-cleanup)
  const generatedPDFSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    filename: { type: String, required: true },
    filepath: { type: String, required: true },
    paperConfigId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaperConfig' },
    pdfType: { type: String, enum: ['paper', 'questions', 'answers', 'answerkey', 'solutions'], required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }, // Auto-delete after this time
    fileSize: { type: Number }, // in bytes
    status: { type: String, enum: ['active', 'expired', 'deleted'], default: 'active' }
  });

  const GeneratedPDF = mongoose.model('GeneratedPDF', generatedPDFSchema);

  // Embedded Document Schema
  const embeddedDocumentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    pdfUrl: { type: String }, // Direct PDF URL for flipbook
    embedCode: { type: String }, // iframe embed code (fallback)
    stream: { type: String, enum: ['jee', 'neet'], required: true },
    subject: { type: String, required: true },
    documentType: { type: String, enum: ['pdf', 'ppt', 'docx', 'other'], default: 'pdf' },
    description: { type: String },
    downloadUrl: { type: String }, // Optional direct download link
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true },
    viewCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    lastModified: { type: Date, default: Date.now }
  });

  const EmbeddedDocument = mongoose.model('EmbeddedDocument', embeddedDocumentSchema);

  // Practice Test Schema
  const practiceTestSchema = new mongoose.Schema({
    name: { type: String, required: true },
    examType: { type: String, enum: ['jee', 'neet'], required: true },
    subject: { type: String, required: true },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'mixed'], required: true },
    questionCount: { type: Number, required: true },
    duration: { type: Number, default: 60 }, // in minutes
    selectionMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  });

  const PracticeTest = mongoose.model('PracticeTest', practiceTestSchema);

  // Create demo users function
  async function createDemoUsers() {
    console.log('👥 Creating demo users...');

    const demoUsers = [
      {
        username: 'student',
        password: 'student123',
        role: 'student',
        email: 'student@demo.com'
      },
      {
        username: 'teacher',
        password: 'teacher123',
        role: 'teacher',
        email: 'teacher@demo.com'
      },
      {
        username: 'admin',
        password: 'admin123',
        role: 'admin',
        email: 'admin@demo.com'
      },
      {
        username: 'admin',
        password: 'admin123',
        role: 'admin',
        email: 'admin@demo.com'
      }
    ];

    try {
      for (const userData of demoUsers) {
        const existingUser = await User.findOne({ username: userData.username });
        if (!existingUser) {
          const user = new User(userData);
          await user.save();
          console.log(`✅ Created demo user: ${userData.username} (${userData.role})`);
        } else {
          console.log(`ℹ️ Demo user already exists: ${userData.username} (${userData.role})`);
        }
      }
      console.log('✅ Demo users setup completed');
    } catch (error) {
      console.error('❌ Error creating demo users:', error);
    }
  }

  // 🚀 MULTI-AI PROVIDER SYSTEM WITH AUTOMATIC FALLBACK
  let aiProviders = [];
  
  // 🔄 GEMINI API KEY ROTATION SYSTEM
  const geminiApiKeys = [];
  let currentKeyIndex = 0;
  const keyUsageTracking = {}; // Track usage per key
  
  // Initialize Gemini API keys from environment
  function initializeGeminiKeys() {
    const keys = [];
    if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
    if (process.env.GEMINI_API_KEY_2) keys.push(process.env.GEMINI_API_KEY_2);
    if (process.env.GEMINI_API_KEY_3) keys.push(process.env.GEMINI_API_KEY_3);
    if (process.env.GEMINI_API_KEY_4) keys.push(process.env.GEMINI_API_KEY_4);
    
    keys.forEach((key, index) => {
      if (key && key.trim()) {
        geminiApiKeys.push(key.trim());
        keyUsageTracking[index] = {
          requestCount: 0,
          lastReset: Date.now(),
          isBlocked: false,
          blockUntil: 0
        };
      }
    });
    
    console.log(`🔑 Loaded ${geminiApiKeys.length} Gemini API key(s) for rotation`);
    return geminiApiKeys.length > 0;
  }
  
  // Get next available Gemini API key with rotation
  function getNextGeminiKey() {
    if (geminiApiKeys.length === 0) return null;
    if (geminiApiKeys.length === 1) return geminiApiKeys[0];
    
    const now = Date.now();
    const RATE_LIMIT = 15; // 15 requests per minute per key
    const MINUTE = 60000;
    
    // Try to find an available key
    for (let i = 0; i < geminiApiKeys.length; i++) {
      const keyIndex = (currentKeyIndex + i) % geminiApiKeys.length;
      const tracking = keyUsageTracking[keyIndex];
      
      // Reset counter if minute has passed
      if (now - tracking.lastReset > MINUTE) {
        tracking.requestCount = 0;
        tracking.lastReset = now;
        tracking.isBlocked = false;
      }
      
      // Check if key is blocked
      if (tracking.isBlocked && now < tracking.blockUntil) {
        const waitTime = Math.ceil((tracking.blockUntil - now) / 1000);
        console.log(`⏳ Key #${keyIndex + 1} blocked for ${waitTime}s more`);
        continue;
      }
      
      // Check if key has capacity
      if (tracking.requestCount < RATE_LIMIT) {
        tracking.requestCount++;
        currentKeyIndex = (keyIndex + 1) % geminiApiKeys.length; // Move to next for next request
        
        const remaining = RATE_LIMIT - tracking.requestCount;
        console.log(`🔑 Using Gemini Key #${keyIndex + 1} (${tracking.requestCount}/${RATE_LIMIT} used, ${remaining} remaining)`);
        
        if (remaining <= 2) {
          console.log(`⚠️ Key #${keyIndex + 1} approaching limit!`);
        }
        
        return geminiApiKeys[keyIndex];
      }
      
      // Key is at limit, block it temporarily
      tracking.isBlocked = true;
      tracking.blockUntil = tracking.lastReset + MINUTE;
      console.log(`🚫 Key #${keyIndex + 1} rate limit reached, blocked until next minute`);
    }
    
    // All keys exhausted
    console.log(`⚠️ All ${geminiApiKeys.length} Gemini keys exhausted! Waiting for reset...`);
    return null;
  }
  
  // Legacy function for backward compatibility
  function checkGeminiRateLimit() {
    return getNextGeminiKey() !== null;
  }

  function initializeAIProviders() {
    console.log('🔧 Initializing Multi-AI Provider System...');
    aiProviders = [];

    // Check environment variables
    console.log('📋 Environment Check:');
    console.log('GEMINI_API_KEY exists:', !!process.env.GEMINI_API_KEY);
    console.log('GROQ_API_KEY exists:', !!process.env.GROQ_API_KEY);
    console.log('COHERE_API_KEY exists:', !!process.env.COHERE_API_KEY);

    // 1. 🌟 GEMINI PROVIDER (GOOGLE AI - Priority 1) - PRIMARY
    if (initializeGeminiKeys()) {
      try {
        aiProviders.push({
          name: 'Gemini',
          type: 'gemini',
          priority: 1,
          speed: 'Fast (200+ tokens/sec) - Vision + PDF Support',
          model: 'gemini-2.0-flash',
          client: {
            createChatCompletion: async (params) => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 60000); // Increased to 60 seconds for PDF processing

              try {
                // Get next available API key with rotation
                const apiKey = getNextGeminiKey();
                if (!apiKey) {
                  throw new Error('All Gemini API keys exhausted - skipping to next provider');
                }
                
                console.log('🌟 Making Gemini API call with image support...');

                const messages = params.messages || [];
                const files = params.files || [];
                
                // Build prompt from ALL messages including conversation history
                let prompt = '';
                
                // First add system message
                messages.forEach(msg => {
                  if (msg.role === 'system') {
                    prompt += `${msg.content}\n\n`;
                  }
                });
                
                // Add conversation history if available
                if (params.conversationHistory && params.conversationHistory.length > 0) {
                  prompt += `\n📚 PREVIOUS CONVERSATION:\n`;
                  params.conversationHistory.forEach(msg => {
                    if (msg.role === 'user') {
                      prompt += `User: ${msg.content}\n\n`;
                    } else if (msg.role === 'assistant') {
                      prompt += `Assistant: ${msg.content}\n\n`;
                    }
                  });
                  prompt += `\n[End of previous conversation]\n\n`;
                }
                
                // Add current messages (non-system)
                messages.forEach(msg => {
                  if (msg.role === 'user') {
                    prompt += `User: ${msg.content}\n\n`;
                  } else if (msg.role === 'assistant') {
                    prompt += `Assistant: ${msg.content}\n\n`;
                  }
                });

                // Build parts array for Gemini (supports text + images + PDFs)
                const parts = [];
                let hasFiles = false;
                
                // Add instruction about attached files first
                if (files.length > 0) {
                  const fileList = files.map(f => `${f.name} (${f.type})`).join(', ');
                  prompt += `\n\n📎 ATTACHED FILES: ${fileList}\n`;
                  prompt += `IMPORTANT: The user has attached files. Please analyze the attached files and answer based on their content. Do NOT ask the user to provide the files again.\n\n`;
                }
                
                parts.push({ text: prompt });

                // Process attached files (images, PDFs, etc.)
                if (files.length > 0) {
                  console.log(`📎 Processing ${files.length} files for Gemini...`);
                  console.log(`📋 Files received:`, files.map(f => ({ name: f.name, type: f.type, hasContent: !!f.content })));
                  
                  for (const file of files) {
                    console.log(`🔍 Processing file: ${file.name}, type: ${file.type}`);
                    if (file.type && file.type.includes('image')) {
                      try {
                        // Extract base64 data and mime type
                        if (file.content && file.content.startsWith('data:')) {
                          const matches = file.content.match(/^data:([^;]+);base64,(.+)$/);
                          if (matches) {
                            const mimeType = matches[1];
                            const base64Data = matches[2];
                            
                            // Add image to parts
                            parts.push({
                              inline_data: {
                                mime_type: mimeType,
                                data: base64Data
                              }
                            });
                            
                            hasFiles = true;
                            console.log(`✅ Added image to Gemini request: ${file.name} (${mimeType})`);
                          }
                        }
                      } catch (err) {
                        console.error(`❌ Error processing image ${file.name}:`, err.message);
                      }
                    } else if (file.type && file.type.includes('pdf')) {
                      // Handle PDF files - Extract text using pdf-parse
                      try {
                        if (file.content && file.content.startsWith('data:')) {
                          const base64Data = file.content.split(',')[1];
                          const pdfBuffer = Buffer.from(base64Data, 'base64');
                          
                          console.log(`📄 Parsing PDF: ${file.name} (${Math.round(pdfBuffer.length/1024)}KB)...`);
                          console.log(`⏳ This may take a moment for large PDFs...`);
                          
                          // Parse PDF to extract text
                          const parseStartTime = Date.now();
                          const pdfData = await pdfParse(pdfBuffer);
                          const parseTime = Date.now() - parseStartTime;
                          console.log(`✅ PDF parsed in ${parseTime}ms`);
                          let extractedText = pdfData.text.trim();
                          
                          if (extractedText && extractedText.length > 10) {
                            // Limit text length to avoid timeout (max 50,000 characters)
                            const maxLength = 50000;
                            let textToSend = extractedText;
                            let wasTruncated = false;
                            
                            if (extractedText.length > maxLength) {
                              textToSend = extractedText.substring(0, maxLength);
                              wasTruncated = true;
                              console.log(`⚠️ PDF text truncated from ${extractedText.length} to ${maxLength} characters`);
                            }
                            
                            // Add extracted text to the prompt
                            parts[0].text += `\n\n📄 PDF FILE: ${file.name}\n`;
                            parts[0].text += `Pages: ${pdfData.numpages}\n`;
                            if (wasTruncated) {
                              parts[0].text += `Note: PDF is large, showing first ${maxLength} characters\n`;
                            }
                            parts[0].text += `Content:\n${textToSend}\n`;
                            parts[0].text += `\n[End of PDF content]\n`;
                            
                            hasFiles = true;
                            console.log(`✅ Extracted ${extractedText.length} characters from PDF (${pdfData.numpages} pages)`);
                          } else {
                            console.log(`⚠️ PDF parsing returned minimal text: "${extractedText}"`);
                            parts[0].text += `\n\n⚠️ PDF file "${file.name}" was uploaded but text extraction yielded minimal content. The PDF may contain images or scanned content.\n`;
                          }
                        }
                      } catch (err) {
                        console.error(`❌ Error parsing PDF ${file.name}:`, err.message);
                        parts[0].text += `\n\n⚠️ Could not parse PDF "${file.name}": ${err.message}\n`;
                      }
                    } else if (file.type && (file.type.includes('text') || file.type.includes('plain'))) {
                      // Handle text files
                      try {
                        if (file.content && file.content.startsWith('data:')) {
                          const base64Content = file.content.split(',')[1];
                          const textContent = Buffer.from(base64Content, 'base64').toString('utf-8');
                          parts[0].text += `\n\n📄 File: ${file.name}\n${textContent}`;
                          console.log(`✅ Added text file to Gemini request: ${file.name}`);
                        }
                      } catch (err) {
                        console.error(`❌ Error processing text file ${file.name}:`, err.message);
                      }
                    } else {
                      // Unknown file type
                      console.log(`⚠️ Unknown file type for ${file.name}: ${file.type}`);
                      
                      // Try to detect PDF by filename
                      if (file.name && file.name.toLowerCase().endsWith('.pdf')) {
                        console.log(`🔄 Detected PDF by filename, attempting to parse...`);
                        try {
                          if (file.content && file.content.startsWith('data:')) {
                            const base64Data = file.content.split(',')[1];
                            const pdfBuffer = Buffer.from(base64Data, 'base64');
                            
                            console.log(`📄 Parsing PDF by filename: ${file.name} (${Math.round(pdfBuffer.length/1024)}KB)...`);
                            
                            const pdfData = await pdfParse(pdfBuffer);
                            let extractedText = pdfData.text.trim();
                            
                            if (extractedText && extractedText.length > 10) {
                              // Limit text length
                              const maxLength = 50000;
                              let textToSend = extractedText;
                              let wasTruncated = false;
                              
                              if (extractedText.length > maxLength) {
                                textToSend = extractedText.substring(0, maxLength);
                                wasTruncated = true;
                                console.log(`⚠️ PDF text truncated from ${extractedText.length} to ${maxLength} characters`);
                              }
                              
                              parts[0].text += `\n\n📄 PDF FILE: ${file.name}\n`;
                              parts[0].text += `Pages: ${pdfData.numpages}\n`;
                              if (wasTruncated) {
                                parts[0].text += `Note: PDF is large, showing first ${maxLength} characters\n`;
                              }
                              parts[0].text += `Content:\n${textToSend}\n`;
                              parts[0].text += `\n[End of PDF content]\n`;
                              
                              hasFiles = true;
                              console.log(`✅ Extracted ${extractedText.length} characters from PDF (${pdfData.numpages} pages)`);
                            }
                          }
                        } catch (err) {
                          console.error(`❌ Error parsing PDF by filename ${file.name}:`, err.message);
                        }
                      }
                    }
                  }
                  
                  if (hasFiles) {
                    console.log(`✅ Successfully added ${parts.length - 1} file(s) to Gemini request`);
                  } else if (files.length > 0) {
                    console.log(`⚠️ Warning: ${files.length} files provided but none were successfully processed`);
                  }
                }

                console.log(`📤 Sending to Gemini: ${parts.length} parts (1 text + ${parts.length - 1} files)`);

                const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    contents: [{
                      parts: parts
                    }],
                    generationConfig: {
                      temperature: params.temperature || 0.3,
                      maxOutputTokens: 4096,
                    }
                  }),
                  signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                  const errorText = await response.text();
                  
                  // Check for rate limit errors
                  if (response.status === 429) {
                    console.error(`⚠️ Gemini Rate Limit Hit (429) - Free tier limits reached`);
                    console.log(`🔄 Will automatically fallback to Cohere or Groq...`);
                    throw new Error(`Gemini rate limit exceeded - Free tier: 15 RPM, 1500 RPD`);
                  } else if (response.status === 403) {
                    console.error(`❌ Gemini API Key Issue (403) - Check your API key`);
                    throw new Error(`Gemini API key invalid or quota exceeded`);
                  } else {
                    console.error(`❌ Gemini API Error (${response.status}):`, errorText);
                    throw new Error(`Gemini API error: ${response.status} - ${errorText.substring(0, 200)}`);
                  }
                }

                const data = await response.json();
                console.log('✅ Gemini API response received');
                const imageCount = files.filter(f => f.type?.includes('image')).length;
                const pdfCount = files.filter(f => f.type?.includes('pdf')).length;
                console.log(`📊 Processed ${files.length} files (${imageCount} images, ${pdfCount} PDFs)`);

                // Extract response text from Gemini API response
                let responseText = '';
                if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
                  responseText = data.candidates[0].content.parts[0].text;
                } else {
                  console.error('❌ Unexpected Gemini response format:', data);
                  throw new Error('Invalid response format from Gemini API');
                }

                return {
                  choices: [{
                    message: {
                      content: responseText,
                      role: 'assistant'
                    }
                  }],
                  provider: 'Gemini',
                  model: 'gemini-2.0-flash'
                };
              } catch (error) {
                clearTimeout(timeoutId);
                console.error('❌ Gemini API failed:', error.message);
                throw error;
              }
            }
          }
        });
        console.log('✅ Gemini AI initialized (Priority 1 - Primary Provider)');
        console.log('📊 Gemini Capabilities:');
        console.log('   - Multi-modal: Text + Images + PDFs');
        console.log('   - Vision: Can read and analyze images');
        console.log('   - PDF Support: Direct PDF processing');
        console.log('📊 Gemini Free Tier Limits:');
        console.log('   - 15 requests per minute (RPM)');
        console.log('   - 1,500 requests per day (RPD)');
        console.log('   - 1M tokens per minute (TPM)');
        console.log('   - Auto-fallback to Cohere/Groq when limits hit');
      } catch (error) {
        console.error('❌ Error initializing Gemini:', error.message);
      }
    }

    // 2. 🔥 COHERE PROVIDER (FAST - Priority 2)
    if (process.env.COHERE_API_KEY) {
      try {
        aiProviders.push({
          name: 'Cohere',
          type: 'cohere',
          priority: 2,
          speed: 'Very Fast (300+ tokens/sec)',
          model: 'command-r-08-2024',
          client: {
            createChatCompletion: async (params) => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30000); // Increased timeout for file processing

              try {
                console.log('🔥 Making Cohere API call with file support...');

                const messages = params.messages || [];
                const files = params.files || [];
                
                // Build enhanced message with file content
                let enhancedMessage = messages[messages.length - 1]?.content || '';
                
                // Process attached files
                if (files.length > 0) {
                  console.log(`📎 Processing ${files.length} attached files for Cohere...`);
                  
                  let fileContext = '\n\n📎 ATTACHED FILES ANALYSIS:\n';
                  let hasProcessableContent = false;
                  
                  for (const file of files) {
                    fileContext += `\n--- FILE: ${file.name} (${file.type}, ${Math.round(file.size/1024)}KB) ---\n`;
                    
                    if (file.type.includes('text') || file.type.includes('plain')) {
                      // For plain text files, extract content from base64
                      try {
                        if (file.content && file.content.startsWith('data:')) {
                          const base64Content = file.content.split(',')[1];
                          const textContent = Buffer.from(base64Content, 'base64').toString('utf-8');
                          fileContext += `TEXT CONTENT:\n${textContent.substring(0, 3000)}\n`;
                          if (textContent.length > 3000) {
                            fileContext += `[Content truncated - showing first 3000 characters of ${textContent.length} total]\n`;
                          }
                          hasProcessableContent = true;
                        }
                      } catch (e) {
                        console.error('Text extraction error:', e);
                        fileContext += `[Text extraction failed for ${file.name}: ${e.message}]\n`;
                      }
                    } else if (file.type.includes('image')) {
                      try {
                        fileContext += `\n🖼️ IMAGE FILE: ${file.name}\n`;
                        fileContext += `File Type: ${file.type}\n`;
                        fileContext += `File Size: ${Math.round(file.size/1024)}KB\n`;
                        
                        if (file.content && file.content.startsWith('data:')) {
                          const base64Content = file.content.split(',')[1];
                          const imageBuffer = Buffer.from(base64Content, 'base64');
                          
                          fileContext += `🔍 Running OCR (text extraction)...\n`;
                          console.log(`📸 Processing image ${file.name} with OCR...`);
                          console.log(`📊 Image buffer size: ${imageBuffer.length} bytes`);
                          
                          const result = await Tesseract.recognize(imageBuffer, 'eng', {
                            logger: (m) => {
                              if (m.status === 'recognizing text') {
                                console.log(`[OCR] ${m.status} (${Math.round(m.progress * 100)}%)`);
                              }
                            },
                            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,;:!?()[]{}+-*/=<>^_|\\~`"\'@#$%&',
                            tessedit_pageseg_mode: Tesseract.PSM.AUTO
                          });
                          
                          const extractedText = result.data.text.trim();
                          
                          if (extractedText && extractedText.length > 5) {
                            fileContext += `\n🧾 OCR TEXT EXTRACTED FROM IMAGE:\n`;
                            fileContext += `"${extractedText.substring(0, 3000)}"\n`;
                            if (extractedText.length > 3000) {
                              fileContext += `[Text truncated - showing first 3000 of ${extractedText.length} characters]\n`;
                            }
                            fileContext += `\n📝 INSTRUCTIONS: Please solve the problem or answer the question shown in the extracted text above.\n`;
                            hasProcessableContent = true;
                            console.log(`✅ OCR successful: extracted ${extractedText.length} characters`);
                            console.log(`📝 Extracted text preview: "${extractedText.substring(0, 200)}..."`);
                          } else {
                            fileContext += `⚠️ OCR completed but found minimal readable text: "${extractedText}"\n`;
                            fileContext += `The image may contain:\n`;
                            fileContext += `- Handwritten content (harder to read)\n`;
                            fileContext += `- Low quality/blurry text\n`;
                            fileContext += `- Non-text content (diagrams, graphs)\n`;
                            fileContext += `\nPlease describe what you see in the image for better assistance.\n`;
                            console.log(`⚠️ OCR found minimal text: "${extractedText}"`);
                          }
                        }
                      } catch (err) {
                        console.error('❌ OCR extraction failed:', err);
                        fileContext += `❌ OCR extraction failed: ${err.message}\n`;
                        fileContext += `Please describe the content of the image manually.\n`;
                      }
                    } else if (file.type.includes('pdf') || file.type.includes('document')) {
                      fileContext += `[DOCUMENT FILE UPLOADED]\n`;
                      fileContext += `File Type: ${file.type}\n`;
                      fileContext += `File Size: ${Math.round(file.size/1024)}KB\n`;
                      fileContext += `\nNOTE: I cannot directly read PDF/document files, but I can help you with:\n`;
                      fileContext += `- Solving problems if you copy and paste the text\n`;
                      fileContext += `- Explaining concepts from the document\n`;
                      fileContext += `- Providing detailed solutions and explanations\n`;
                      fileContext += `\nPlease copy and paste the relevant text or problem statement from the document.\n`;
                    } else {
                      fileContext += `[UNSUPPORTED FILE TYPE: ${file.type}]\n`;
                      fileContext += `Please convert to a supported format (TXT for text content) or describe the content.\n`;
                    }
                    
                    if (file.options) {
                      fileContext += `\nProcessing Options Selected:\n`;
                      if (file.options.extractText) fileContext += '- Extract text content\n';
                      if (file.options.analyzeImages) fileContext += '- Analyze images\n';
                      if (file.options.summarizeContent) fileContext += '- Summarize content\n';
                      if (file.options.detectLanguage) fileContext += '- Detect language\n';
                    }
                  }
                  
                  if (!hasProcessableContent) {
                    fileContext += `\n⚠️ IMPORTANT: I cannot directly process the uploaded file format(s).\n`;
                    fileContext += `However, I can still assist you in solving the problem if you can:\n`;
                    fileContext += `1. Describe the content of the file\n`;
                    fileContext += `2. Copy and paste any text, equations, or problem statements\n`;
                    fileContext += `3. Describe any diagrams, graphs, or images\n`;
                    fileContext += `\nPlease provide more context and details about the problem, and I'll do my best to help you solve it.\n`;
                  }
                  
                  enhancedMessage += fileContext;
                }

                // Add context about conversation continuity
                if (params.conversationHistory && params.conversationHistory.length > 0) {
                  enhancedMessage += `\n\n📚 CONVERSATION CONTEXT: This is part of an ongoing conversation. Use previous context to provide better, more personalized responses while solving this specific problem.`;
                }

                // Prepare conversation for Cohere format
                let cohereMessages = [];
                if (params.messages && params.messages.length > 0) {
                  // Convert messages to Cohere format
                  params.messages.forEach(msg => {
                    if (msg.role === 'user') {
                      cohereMessages.push({
                        role: 'USER',
                        message: msg.content
                      });
                    } else if (msg.role === 'assistant') {
                      cohereMessages.push({
                        role: 'CHATBOT',
                        message: msg.content
                      });
                    }
                  });
                }

                const requestBody = {
                  model: 'command-r-08-2024',
                  message: enhancedMessage,
                  temperature: params.temperature || 0.3,
                  max_tokens: 4096,
                  stream: false,
                  preamble: params.messages && params.messages[0] && params.messages[0].role === 'system' 
                    ? params.messages[0].content 
                    : "You are an expert JEE/NEET tutor. Provide accurate, step-by-step solutions."
                };

                // Add conversation history if available
                if (cohereMessages.length > 1) {
                  requestBody.chat_history = cohereMessages.slice(0, -1); // Exclude the current message
                }

                console.log('📤 Sending request to Cohere API...');
                console.log('📝 Request body:', JSON.stringify(requestBody, null, 2).substring(0, 1000) + '...');

                const response = await fetch('https://api.cohere.ai/v1/chat', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(requestBody),
                  signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                  const errorText = await response.text();
                  console.error(`❌ Cohere API Error (${response.status}):`, errorText);
                  throw new Error(`Cohere API error: ${response.status} - ${errorText.substring(0, 200)}`);
                }

                const data = await response.json();
                console.log('✅ Cohere API response received');
                console.log('📊 Response data keys:', Object.keys(data));

                // Extract response text from Cohere API response
                let responseText = '';
                if (data.text) {
                  responseText = data.text;
                } else if (data.message) {
                  responseText = data.message;
                } else if (data.response) {
                  responseText = data.response;
                } else {
                  console.error('❌ Unexpected Cohere response format:', data);
                  throw new Error('Invalid response format from Cohere API');
                }

                return {
                  choices: [{
                    message: {
                      content: responseText,
                      role: 'assistant'
                    }
                  }],
                  provider: 'Cohere',
                  model: 'command-r-08-2024',
                  filesProcessed: files ? files.length : 0
                };
              } catch (error) {
                clearTimeout(timeoutId);
                console.error('❌ Cohere API failed:', error.message);
                throw error;
              }
            }
          }
        });
        console.log('✅ Cohere AI initialized (Priority 2 - Very Fast)');
      } catch (error) {
        console.error('❌ Error initializing Cohere:', error.message);
      }
    }

    // 3. 🚀 GROQ PROVIDER (ULTRA FAST - Priority 3)
    if (process.env.GROQ_API_KEY) {
      try {
        aiProviders.push({
          name: 'Groq',
          type: 'groq',
          priority: 3,
          speed: 'Ultra Fast (500+ tokens/sec)',
          model: 'llama-3.1-8b-instant',
          client: {
            createChatCompletion: async (params) => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 15000);

              try {
                console.log('🚀 Making Groq API call...');

                const messages = params.messages || [];
                
                // Modify messages to include conversation context
                const modifiedMessages = messages.map((msg, index) => {
                  if (index === messages.length - 1 && msg.role === 'user') {
                    let contextNote = '';
                    if (params.conversationHistory && params.conversationHistory.length > 0) {
                      contextNote = `\n\n📚 CONVERSATION CONTEXT: This is part of an ongoing conversation. Use previous context to provide better, more personalized responses.`;
                    }
                    return {
                      ...msg,
                      content: msg.content + contextNote
                    };
                  }
                  return msg;
                });

                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages: modifiedMessages,
                    temperature: params.temperature || 0.3, // Lower temperature for more accurate responses
                    max_tokens: 4096,
                    stream: false
                  }),
                  signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                  const errorText = await response.text();
                  throw new Error(`Groq API error: ${response.status} ${errorText}`);
                }

                const data = await response.json();
                console.log('✅ Groq API success');
                return data;
              } catch (error) {
                clearTimeout(timeoutId);
                console.error('❌ Groq API failed:', error.message);
                throw error;
              }
            }
          }
        });
        console.log('✅ Groq AI initialized (Priority 2 - Ultra Fast)');
      } catch (error) {
        console.error('❌ Error initializing Groq:', error.message);
      }
    }





    // Sort providers by priority (fastest first)
    aiProviders.sort((a, b) => a.priority - b.priority);

    console.log(`\n🎯 AI Provider Summary:`);
    console.log(`Total Providers: ${aiProviders.length}`);
    aiProviders.forEach(provider => {
      console.log(`  ${provider.priority}. ${provider.name} (${provider.model}) - ${provider.speed}`);
    });

    if (aiProviders.length === 0) {
      console.log('⚠️ No AI providers configured - using fallback mode only');
    } else {
      console.log(`\n✅ Multi-AI System Ready with ${aiProviders.length} providers!`);
      console.log(`   Priority Order: ${aiProviders.map(p => p.name).join(' → ')}`);
    }
  }

  // 🎯 SMART AI PROVIDER SELECTION WITH AUTOMATIC FALLBACK
  async function callAIWithFallback(params) {
    if (aiProviders.length === 0) {
      throw new Error('No AI providers available');
    }

    for (let i = 0; i < aiProviders.length; i++) {
      const provider = aiProviders[i];
      try {
        console.log(`🎯 Trying ${provider.name} (Priority ${provider.priority})...`);
        const startTime = Date.now();

        // Skip file-heavy requests for providers that don't support files well
        let modifiedParams = { ...params };
        if ((provider.type === 'groq' || provider.type === 'cohere') && params.files && params.files.length > 0) {
          console.log(`⚠️ ${provider.name} doesn't support files, skipping files for this provider`);
          modifiedParams = { ...params, files: [] };

          // Add file info to the message for text-only providers
          if (params.files.length > 0) {
            const fileInfo = params.files.map(f => `📎 ${f.name} (${f.mimeType})`).join(', ');
            modifiedParams.messages = modifiedParams.messages.map((msg, index) => {
              if (index === modifiedParams.messages.length - 1 && msg.role === 'user') {
                return {
                  ...msg,
                  content: `${msg.content}\n\n[Note: User uploaded files: ${fileInfo}. Please acknowledge that you cannot process these files and ask the user to describe the content instead.]`
                };
              }
              return msg;
            });
          }
        }

        const result = await provider.client.createChatCompletion(modifiedParams);

        const endTime = Date.now();
        const responseTime = endTime - startTime;
        console.log(`✅ ${provider.name} succeeded in ${responseTime}ms`);

        return {
          ...result,
          provider: provider.name,
          model: provider.model,
          responseTime: responseTime,
          speed: provider.speed
        };
      } catch (error) {
        console.log(`❌ ${provider.name} failed: ${error.message}`);

        // If this is the last provider, throw the error
        if (i === aiProviders.length - 1) {
          throw error;
        }

        // Otherwise, continue to next provider
        console.log(`🔄 Falling back to next provider...`);
      }
    }
  }

  // Initialize AI providers and log results
  initializeAIProviders();

  // Debug: Log provider initialization results
  setTimeout(() => {
    console.log('\n🔍 AI Provider Debug Info:');
    console.log('Total providers initialized:', aiProviders.length);
    aiProviders.forEach((provider, index) => {
      console.log(`${index + 1}. ${provider.name} - ${provider.type} - Priority ${provider.priority}`);
    });

    if (aiProviders.length === 0) {
      console.log('⚠️ WARNING: No AI providers initialized!');
      console.log('Environment variables check:');
      console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? 'SET' : 'NOT SET');
      console.log('COHERE_API_KEY:', process.env.COHERE_API_KEY ? 'SET' : 'NOT SET');
    }
  }, 1000);

  // Middleware
  app.use(cors());
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

  // Disable caching for HTML files to ensure updates are loaded
  app.use((req, res, next) => {
    if (req.url.endsWith('.html') || req.url === '/') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  // Initialize default data
  async function initializeDefaultData() {
    try {
      console.log('🔧 Checking and creating default users...');

      const defaultUsers = [
        {
          username: 'admin',
          password: 'admin123',
          role: 'admin',
          email: 'admin@edusphere.com'
        },

      ];

      let createdCount = 0;
      for (const userData of defaultUsers) {
        const existingUser = await User.findOne({ username: userData.username });
        if (!existingUser) {
          const user = new User(userData);
          await user.save();
          console.log(`✅ Created user: ${userData.username} (${userData.role})`);
          createdCount++;
        } else {
          console.log(`ℹ️ User already exists: ${userData.username} (${existingUser.role})`);
        }
      }

      if (createdCount > 0) {
        console.log(`✅ Created ${createdCount} default users`);
      } else {
        console.log('ℹ️ All default users already exist');
      }

      // Check final user count
      const totalUsers = await User.countDocuments();
      console.log(`👥 Total users in database: ${totalUsers}`);

      // List all users for debugging
      const allUsers = await User.find({}, 'username role email');
      console.log('📋 Current users:', allUsers.map(u => `${u.username} (${u.role})`).join(', '));

      // If no users exist at all, something is wrong - force create them
      if (totalUsers === 0) {
        console.log('⚠️ No users found in database! Force creating default users...');
        for (const userData of defaultUsers) {
          const user = new User(userData);
          await user.save();
          console.log(`✅ Force created user: ${userData.username} (${userData.role})`);
        }
      }

      // Default chapters initialization disabled - chapters will be added manually

      // Skip creating default questions - let admin/teachers add questions manually
      const questionCount = await Question.countDocuments();
      console.log(`📊 Current question count: ${questionCount}`);

    } catch (error) {
      console.error('❌ Error initializing default data:', error);
    }
  }

  // Default chapter initialization removed - chapters will be added manually through the UI

  // Authentication middleware
  const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    console.log('🔐 Auth Debug:', {
      hasAuthHeader: !!authHeader,
      authHeader: authHeader?.substring(0, 20) + '...',
      endpoint: req.path
    });

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Auth failed: No Bearer token');
      return res.status(401).json({
        success: false,
        error: 'Authentication token required'
      });
    }

    const token = authHeader.substring(7);
    const username = token.replace('-token', '');

    console.log('🔍 Token Debug:', {
      token: token,
      extractedUsername: username
    });

    try {
      const user = await User.findOne({
        $or: [
          { username: username },
          { email: username + '@edusphere.com' }
        ]
      });

      console.log('👤 User lookup result:', {
        found: !!user,
        username: user?.username,
        role: user?.role
      });

      if (user) {
        req.user = user;
        next();
      } else {
        console.log('❌ Auth failed: User not found for username:', username);
        res.status(401).json({
          success: false,
          error: 'Invalid authentication token'
        });
      }
    } catch (error) {
      console.error('❌ Auth error:', error);
      res.status(500).json({
        success: false,
        error: 'Authentication error'
      });
    }
  };

  // Routes

  // User authentication
  app.post('/api/auth/login', async (req, res) => {
    const { username, password, role } = req.body;

    console.log('🔐 Login attempt:', { username, role });

    if (!username || !password || !role) {
      return res.status(400).json({
        success: false,
        error: 'Username, password, and role are required'
      });
    }

    try {
      const user = await User.findOne({ username });
      console.log('👤 User found:', { found: !!user, userRole: user?.role, requestedRole: role });

      if (user) {
        const validPassword = await user.comparePassword(password);
        console.log('🔑 Password valid:', validPassword);

        if (validPassword && user.role === role) {
          const token = `${user.username}-token`;
          console.log('✅ Login successful, token:', token);

          return res.json({
            success: true,
            user: {
              _id: user._id,
              id: user._id,
              username: user.username,
              role: user.role,
              email: user.email,
              isAdmin: user.role === 'admin'
            },
            token: token,
            isAdmin: user.role === 'admin'
          });
        } else {
          console.log('❌ Login failed: Invalid password or role mismatch');
          return res.status(401).json({
            success: false,
            error: 'Invalid username, password, or role'
          });
        }
      } else {
        console.log('❌ Login failed: User not found');
        return res.status(401).json({
          success: false,
          error: 'Invalid username, password, or role'
        });
      }
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error during login'
      });
    }
  });

  // User registration
  app.post('/api/auth/register', async (req, res) => {
    const { username, password, email, role } = req.body;

    console.log('📝 Registration attempt:', { username, email, role });

    // Validation
    if (!username || !password || !email || !role) {
      return res.status(400).json({
        success: false,
        error: 'Username, password, email, and role are required'
      });
    }

    // Validate role
    if (!['student', 'teacher', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be student, teacher, or admin'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid email address'
      });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    try {
      // Check if username already exists
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'Username already exists. Please choose a different username.'
        });
      }

      // Check if email already exists
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          error: 'Email already registered. Please use a different email or login.'
        });
      }

      // Create new user
      const newUser = new User({
        username,
        password, // Will be hashed by the pre-save middleware
        email,
        role
      });

      await newUser.save();

      console.log('✅ User registered successfully:', { username, email, role });

      // Generate token
      const token = `${newUser.role}-token`;

      res.status(201).json({
        success: true,
        message: 'Registration successful! Welcome to EduSphere Pro!',
        user: {
          _id: newUser._id,
          id: newUser._id,
          username: newUser.username,
          role: newUser.role,
          email: newUser.email
        },
        token: token
      });

    } catch (error) {
      console.error('❌ Registration error:', error);

      if (error.code === 11000) {
        // Duplicate key error
        const field = Object.keys(error.keyPattern)[0];
        return res.status(409).json({
          success: false,
          error: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Registration failed. Please try again.'
      });
    }
  });

  // Integrated training examples for better AI responses
  const trainingExamples = {
    physics: {
      problemSolving: `
**PHYSICS PROBLEM-SOLVING APPROACH:**
1. **IDENTIFY**: What type of physics problem (mechanics, electromagnetism, etc.)
2. **GIVEN DATA**: List all given values with units
3. **FIND**: Clearly state what needs to be calculated
4. **CONCEPTS**: Identify relevant physics principles and formulas
5. **SOLVE**: Step-by-step calculation with proper units
6. **VERIFY**: Check if answer makes physical sense

**COMMON FORMULAS:**
- Mechanics: F=ma, v²=u²+2as, KE=½mv², PE=mgh
- Electricity: V=IR, P=VI, F=kq₁q₂/r²
- Waves: v=fλ, E=hf
- Modern Physics: E=mc², λ=h/p
      `
    },
    chemistry: {
      problemSolving: `
**CHEMISTRY PROBLEM-SOLVING APPROACH:**
1. **IDENTIFY**: Reaction type (organic, inorganic, physical chemistry)
2. **MECHANISM**: Draw electron movement for organic reactions
3. **STOICHIOMETRY**: Balance equations and calculate moles
4. **CONDITIONS**: Consider temperature, pressure, catalysts
5. **PRODUCTS**: Predict major and minor products
6. **VERIFY**: Check atom balance and charge balance

**KEY CONCEPTS:**
- Organic: Electron movement, stereochemistry, reaction mechanisms
- Inorganic: Oxidation states, coordination chemistry, periodic trends
- Physical: Thermodynamics, kinetics, equilibrium
      `
    },
    mathematics: {
      problemSolving: `
**MATHEMATICS PROBLEM-SOLVING APPROACH:**
1. **UNDERSTAND**: Read problem carefully, identify what's asked
2. **PLAN**: Choose appropriate method (algebraic, geometric, calculus)
3. **EXECUTE**: Solve step-by-step with clear working
4. **CHECK**: Verify answer by substitution or alternative method
5. **INTERPRET**: Ensure answer makes sense in context

**COMMON TECHNIQUES:**
- Algebra: Factoring, substitution, elimination
- Calculus: Differentiation, integration, limits
- Geometry: Coordinate geometry, trigonometry
- Probability: Combinations, permutations, conditional probability
      `
    },
    biology: {
      problemSolving: `
**BIOLOGY PROBLEM-SOLVING APPROACH:**
1. **IDENTIFY**: System/process involved (cellular, physiological, ecological)
2. **MECHANISM**: Understand the biological process step-by-step
3. **FACTORS**: Consider all influencing factors
4. **CONNECTIONS**: Link to other biological processes
5. **APPLICATIONS**: Real-world relevance and medical connections

**KEY AREAS:**
- Cell Biology: Membrane transport, metabolism, cell division
- Physiology: Organ systems, homeostasis, regulation
- Genetics: Inheritance patterns, molecular genetics
- Ecology: Population dynamics, ecosystem interactions
      `
    }
  };
  console.log('✅ AI training examples integrated successfully');

  // Subject detector for better context
  function detectSubject(query) {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('physics') || lowerQuery.includes('force') || lowerQuery.includes('motion') || 
        lowerQuery.includes('electric') || lowerQuery.includes('magnetic') || lowerQuery.includes('wave') ||
        lowerQuery.includes('energy') || lowerQuery.includes('momentum')) {
      return 'physics';
    } else if (lowerQuery.includes('chemistry') || lowerQuery.includes('organic') || lowerQuery.includes('inorganic') ||
               lowerQuery.includes('reaction') || lowerQuery.includes('molecule') || lowerQuery.includes('bond') ||
               lowerQuery.includes('acid') || lowerQuery.includes('base')) {
      return 'chemistry';
    } else if (lowerQuery.includes('math') || lowerQuery.includes('calculus') || lowerQuery.includes('algebra') ||
               lowerQuery.includes('geometry') || lowerQuery.includes('integral') || lowerQuery.includes('derivative') ||
               lowerQuery.includes('equation') || lowerQuery.includes('function')) {
      return 'mathematics';
    } else if (lowerQuery.includes('biology') || lowerQuery.includes('cell') || lowerQuery.includes('gene') ||
               lowerQuery.includes('protein') || lowerQuery.includes('enzyme') || lowerQuery.includes('DNA') ||
               lowerQuery.includes('physiology') || lowerQuery.includes('anatomy')) {
      return 'biology';
    }
    
    return 'general';
  }

  // Get relevant training context based on subject
  function getRelevantTrainingContext(subject) {
    if (!trainingExamples[subject]) {
      return trainingExamples.mathematics.problemSolving; // Default fallback
    }

    return `
🎓 **${subject.toUpperCase()} PROBLEM-SOLVING METHODOLOGY:**

${trainingExamples[subject].problemSolving}

**CRITICAL INSTRUCTIONS:**
- ALWAYS provide fresh, original solutions - never repeat previous answers
- Show complete step-by-step working for the CURRENT problem only
- Use proper mathematical notation with LaTeX formatting
- Explain the reasoning behind each step
- Verify your final answer
- Focus specifically on the question asked, not general concepts
`;
  }

  // Problem difficulty analyzer for better AI responses
  function analyzeProblemComplexity(query) {
    const complexityIndicators = {
      high: ['advanced', 'complex', 'difficult', 'challenging', 'multi-step', 'integration', 'differential', 'mechanism', 'synthesis', 'prove', 'derive'],
      medium: ['calculate', 'find', 'determine', 'solve', 'explain', 'compare', 'analyze'],
      low: ['define', 'list', 'identify', 'name', 'what is', 'simple']
    };

    const lowerQuery = query.toLowerCase();
    let complexity = 'medium'; // default

    if (complexityIndicators.high.some(indicator => lowerQuery.includes(indicator))) {
      complexity = 'high';
    } else if (complexityIndicators.low.some(indicator => lowerQuery.includes(indicator))) {
      complexity = 'low';
    }

    return complexity;
  }

  // Enhanced system prompt based on problem complexity
  function getEnhancedSystemPrompt(complexity, subject = '', query = '') {
    const basePrompt = `You are an ELITE JEE/NEET expert tutor with 15+ years of experience training top rankers. You specialize in solving the most challenging competitive exam problems with precision and clarity.`;

    const complexityEnhancements = {
      high: `
🔥 ULTRA-ADVANCED MODE ACTIVATED 🔥
You are now handling a HIGH COMPLEXITY problem that requires:
- Multi-step reasoning with intermediate verification
- Integration of multiple concepts from different chapters
- Advanced mathematical techniques and approximations
- Deep conceptual understanding beyond formula application
- Identification of subtle problem-solving tricks and shortcuts
- Connection to real-world applications and advanced theory

APPROACH: Break down into smaller sub-problems, solve systematically, and provide multiple solution methods where possible.`,
      
      medium: `
⚡ STANDARD EXCELLENCE MODE ⚡
This is a MEDIUM COMPLEXITY problem requiring:
- Clear step-by-step methodology
- Proper application of fundamental concepts
- Logical reasoning with formula derivations
- Verification of results and units
- Connection to related concepts

APPROACH: Provide structured solution with clear explanations at each step.`,
      
      low: `
📚 FOUNDATION BUILDING MODE 📚
This is a BASIC LEVEL query focusing on:
- Clear conceptual explanations
- Fundamental principle clarification
- Building blocks for advanced topics
- Simple examples and analogies
- Preparation for more complex problems

APPROACH: Focus on building strong conceptual foundation with simple, clear explanations.`
    };

    // Add relevant training context
    const trainingContext = getRelevantTrainingContext(subject);

    return basePrompt + complexityEnhancements[complexity] + trainingContext + `

🚨 **CRITICAL RESPONSE REQUIREMENTS:**
- Provide FRESH, accurate analysis for each question
- Show COMPLETE working for the specific problem asked
- Use proper LaTeX formatting for all mathematical expressions
- Explain each step clearly with reasoning
- Provide numerical answers where applicable
- Check your work and verify the solution makes sense
- If this is part of a conversation, maintain context and build upon previous discussions

� **RcESPONSE FORMAT:**
1. **Problem Analysis**: Understand what's being asked
2. **Given Information**: List all provided data
3. **Solution Strategy**: Explain your approach
4. **Step-by-Step Solution**: Show all calculations with clear explanations
5. **Final Answer**: Clear, highlighted result
6. **Verification**: Check if answer is reasonable


🧠 SPECIALIZED KNOWLEDGE BASE:
**PHYSICS (JEE Advanced Level):**
- Mechanics: Complex rotational motion, oscillations, wave interference
- Electromagnetism: Advanced circuit analysis, electromagnetic induction, AC circuits
- Modern Physics: Photoelectric effect, atomic structure, nuclear physics
- Thermodynamics: Carnot cycles, entropy, kinetic theory applications

**CHEMISTRY (JEE/NEET Advanced):**
- Organic: Complex reaction mechanisms, stereochemistry, named reactions
- Inorganic: Coordination chemistry, metallurgy, p-block elements
- Physical: Chemical kinetics, electrochemistry, surface chemistry
- Analytical: Qualitative/quantitative analysis, spectroscopy basics

**MATHEMATICS (JEE Advanced):**
- Calculus: Advanced integration techniques, differential equations
- Algebra: Complex numbers, matrices, probability distributions
- Coordinate Geometry: Conic sections, 3D geometry applications
- Trigonometry: Inverse functions, complex trigonometric equations

**BIOLOGY (NEET Advanced):**
- Human Physiology: Detailed organ systems, hormonal regulation
- Plant Biology: Photosynthesis mechanisms, plant hormones
- Genetics: Advanced inheritance patterns, molecular genetics
- Ecology: Population dynamics, ecosystem interactions

🔬 PROBLEM-SOLVING METHODOLOGY:
1. **ANALYZE**: Break down the problem, identify given data and required solution
2. **STRATEGIZE**: Choose the most efficient approach, explain why
3. **EXECUTE**: Solve step-by-step with clear mathematical/scientific reasoning
4. **VERIFY**: Check the solution for reasonableness and units
5. **EXTEND**: Provide related concepts or variations for deeper understanding

📎 ENHANCED FILE PROCESSING:
- Extract and solve problems from images using OCR
- Handle complex diagrams and mathematical expressions
- Process multiple-choice questions with detailed explanations
- Analyze graphs, charts, and experimental data

🎯 SOLUTION QUALITY STANDARDS:
- Always show complete working with intermediate steps
- Explain the physics/chemistry/biology behind each step
- Highlight key concepts and formulas used
- Provide alternative solution methods when applicable
- Include common pitfalls and how to avoid them

MATHEMATICAL FORMATTING (LaTeX):
- Inline: $E = mc^2$, $\\frac{dy}{dx}$, $\\int_0^\\infty e^{-x}dx$
- Display: $\\Delta G = \\Delta H - T\\Delta S$, $\\nabla \\times \\vec{E} = -\\frac{\\partial \\vec{B}}{\\partial t}$
- Complex: $\\lim_{n \\to \\infty} \\sum_{k=1}^n \\frac{1}{k^2} = \\frac{\\pi^2}{6}$

🏆 SUCCESS METRICS:
Your goal is to help students achieve JEE Advanced AIR < 1000 and NEET AIR < 500 level understanding.
Focus on building strong conceptual foundation while solving challenging problems efficiently.

CONVERSATION CONTEXT: Maintain continuity and build upon previous discussions to create a comprehensive learning experience.`;
  }

  // 🚀 ENHANCED MULTI-AI GUIDANCE WITH SMART FALLBACK
  app.post('/api/ai-guidance', authenticate, async (req, res) => {
    const { query, files, preferredProvider, conversationHistory } = req.body;

    // Analyze problem complexity and subject for better AI response
    const problemComplexity = analyzeProblemComplexity(query || '');
    const detectedSubject = detectSubject(query || '');
    
    // Use provided conversation history (simple session-based memory)
    const fullConversationHistory = conversationHistory || [];
    
    const enhancedSystemPrompt = getEnhancedSystemPrompt(problemComplexity, detectedSubject, query);

    console.log('🤖 Enhanced Multi-AI Guidance Request:', {
      query: query,
      detectedSubject: detectedSubject,
      problemComplexity: problemComplexity,
      historyLength: fullConversationHistory.length,
      filesCount: files ? files.length : 0,
      availableProviders: aiProviders.length,
      providers: aiProviders.map(p => p.name),
      user: req.user?.username,
      timestamp: new Date().toISOString()
    });

    if (!query && (!files || files.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'Query or files are required'
      });
    }

    try {
      let guidance;
      let provider = 'fallback';
      let responseTime = 0;
      let model = '';
      let speed = '';

      console.log(`🔍 Available AI Providers: ${aiProviders.length}`);

      // Try AI providers with smart fallback or specific provider
      if (aiProviders.length > 0) {
        try {
          if (preferredProvider && preferredProvider !== 'auto') {
            console.log(`🎯 User selected specific provider: ${preferredProvider}`);
            const selectedProvider = aiProviders.find(p => p.type === preferredProvider);
            if (selectedProvider) {
              console.log(`🚀 Attempting ${selectedProvider.name} specifically...`);
              try {
                const startTime = Date.now();
                const result = await selectedProvider.client.createChatCompletion({
                  messages: [
                    {
                      role: "system",
                      content: enhancedSystemPrompt
                    },
                    // Include full conversation history
                    ...fullConversationHistory,
                    {
                      role: "user",
                      content: query || "Please analyze the attached files."
                    }
                  ],
                  files: files || [],
                  conversationHistory: fullConversationHistory,
                  max_tokens: 4096,
                  temperature: 0.7,
                  stream: false
                });

                const endTime = Date.now();
                const responseTime = endTime - startTime;

                if (result.choices && result.choices[0] && result.choices[0].message) {
                  guidance = result.choices[0].message.content;
                  provider = selectedProvider.name;
                  model = selectedProvider.model;
                  speed = selectedProvider.speed;
                  responseTime = responseTime;
                  console.log(`✅ ${provider} (selected) response successful in ${responseTime}ms`);
                }
              } catch (providerError) {
                console.log(`❌ Selected provider ${selectedProvider.name} failed: ${providerError.message}`);

                // Provide specific error message but still try fallback for better user experience
                console.log('🔄 Falling back to automatic selection due to provider failure...');
                guidance = null; // This will trigger the fallback below
              }
            }
          }

          // If no specific provider selected or it failed, use smart fallback
          if (!guidance) {
            try {
              console.log('🚀 Attempting Multi-AI call with smart fallback...');

              const completion = await callAIWithFallback({
                messages: [
                  {
                    role: "system",
                    content: enhancedSystemPrompt
                  },
                  // Include full conversation history
                  ...fullConversationHistory,
                  {
                    role: "user",
                    content: query || "Please analyze the attached files."
                  }
                ],
                files: files || [],
                conversationHistory: fullConversationHistory,
                max_tokens: 4096,
                temperature: 0.7,
                stream: false
              });

              if (completion.choices && completion.choices[0] && completion.choices[0].message) {
                guidance = completion.choices[0].message.content;
                provider = completion.provider;
                model = completion.model;
                speed = completion.speed;
                responseTime = completion.responseTime;
                console.log(`✅ ${provider} response successful in ${responseTime}ms (with ${files ? files.length : 0} files)`);
              }
            } catch (aiError) {
              console.error('❌ All AI providers failed:', aiError.message);
            }
          }
        } catch (error) {
          console.error('❌ AI provider system error:', error.message);
        }
      }

      // Use fallback if all AI providers failed or not available
      if (!guidance) {
        console.log('🔄 Using enhanced fallback guidance');
        const startTime = Date.now();
        guidance = generateEnhancedFallbackGuidance(query);
        responseTime = Date.now() - startTime;
        provider = 'fallback';
        model = 'local-fallback';
        speed = 'Instant';
      }

      console.log(`📊 AI Response Summary:`);
      console.log(`   Provider: ${provider}`);
      console.log(`   Model: ${model}`);
      console.log(`   Response Length: ${guidance.length} characters`);
      console.log(`   Response Time: ${responseTime}ms`);
      console.log(`   Problem Complexity: ${problemComplexity}`);
      console.log(`   Detected Subject: ${detectedSubject}`);
      console.log(`🔍 Response Preview: ${guidance.substring(0, 200)}...`);

      const responseData = {
        success: true,
        guidance: guidance,
        response: guidance, // Add for compatibility
        provider: provider,
        model: model,
        speed: speed,
        responseTime: responseTime,
        query: query,
        problemComplexity: problemComplexity,
        detectedSubject: detectedSubject,
        enhancedMode: true,
        conversationLength: fullConversationHistory.length,
        availableProviders: aiProviders.map(p => ({
          name: p.name,
          model: p.model,
          speed: p.speed,
          priority: p.priority
        }))
      };

      console.log(`📤 Sending response:`, {
        success: responseData.success,
        guidanceLength: responseData.guidance?.length,
        provider: responseData.provider,
        model: responseData.model
      });

      res.json(responseData);

    } catch (error) {
      console.error('💥 AI guidance endpoint error:', error);
      const fallbackGuidance = generateEnhancedFallbackGuidance(query);

      res.json({
        success: true,
        guidance: fallbackGuidance,
        provider: 'fallback-error',
        model: 'local-fallback',
        speed: 'Instant',
        responseTime: 0,
        query: query,
        error: error.message
      });
    }
  });

  // Enhanced fallback guidance with JEE/NEET level problem-solving
  function generateEnhancedFallbackGuidance(query) {
    const lowerQuery = query.toLowerCase();

    let topicGuidance = '';
    let specificTips = '';
    let advancedStrategies = '';

    if (lowerQuery.includes('physics') || lowerQuery.includes('mechanic') || lowerQuery.includes('electr')) {
      topicGuidance = 'Advanced Physics';
      specificTips = `
        <h4>🔬 JEE Advanced Physics Mastery:</h4>
        <ul>
          <li><strong>Mechanics:</strong> Lagrangian mechanics, complex oscillations, collision dynamics</li>
          <li><strong>Electromagnetism:</strong> Maxwell's equations, electromagnetic waves, advanced circuits</li>
          <li><strong>Modern Physics:</strong> Quantum mechanics basics, nuclear reactions, particle physics</li>
          <li><strong>Thermodynamics:</strong> Statistical mechanics, entropy calculations, heat engines</li>
        </ul>
        <p><strong>Problem-Solving Approach:</strong> Always draw free body diagrams, identify conservation laws, use dimensional analysis</p>
      `;
      advancedStrategies = `
        <div class="advanced-strategies">
          <h5>🎯 Advanced Problem-Solving Techniques:</h5>
          <ul>
            <li><strong>Multi-Concept Integration:</strong> Combine mechanics with electromagnetism</li>
            <li><strong>Approximation Methods:</strong> Use small angle approximations, Taylor expansions</li>
            <li><strong>Graphical Analysis:</strong> Interpret v-t, a-t graphs for complex motion</li>
            <li><strong>Energy Methods:</strong> Use energy conservation for complex systems</li>
          </ul>
        </div>
      `;
    } else if (lowerQuery.includes('chemistry') || lowerQuery.includes('organic') || lowerQuery.includes('inorganic')) {
      topicGuidance = 'Advanced Chemistry';
      specificTips = `
        <h4>🧪 JEE/NEET Advanced Chemistry:</h4>
        <ul>
          <li><strong>Organic Mechanisms:</strong> Arrow pushing, stereochemistry, pericyclic reactions</li>
          <li><strong>Inorganic Complexes:</strong> Crystal field theory, coordination isomerism</li>
          <li><strong>Physical Chemistry:</strong> Quantum chemistry, statistical thermodynamics</li>
          <li><strong>Analytical Chemistry:</strong> Spectroscopy (IR, NMR, Mass spec), chromatography</li>
        </ul>
        <p><strong>Advanced Strategy:</strong> Master reaction mechanisms, not just products. Understand WHY reactions occur.</p>
      `;
      advancedStrategies = `
        <div class="advanced-strategies">
          <h5>🎯 Chemistry Problem-Solving Excellence:</h5>
          <ul>
            <li><strong>Mechanism Mastery:</strong> Draw complete electron movement for organic reactions</li>
            <li><strong>Thermodynamic Analysis:</strong> Use ΔG, ΔH, ΔS to predict reaction feasibility</li>
            <li><strong>Kinetic Studies:</strong> Analyze rate laws, activation energies, catalysis</li>
            <li><strong>Structure-Property Relations:</strong> Connect molecular structure to chemical behavior</li>
          </ul>
        </div>
      `;
    } else if (lowerQuery.includes('math') || lowerQuery.includes('calculus') || lowerQuery.includes('algebra')) {
      topicGuidance = 'Advanced Mathematics';
      specificTips = `
        <h4>➗ JEE Advanced Mathematics:</h4>
        <ul>
          <li><strong>Calculus:</strong> Advanced integration (substitution, parts, partial fractions), differential equations</li>
          <li><strong>Algebra:</strong> Complex analysis, matrix theory, advanced probability</li>
          <li><strong>Geometry:</strong> 3D coordinate geometry, vector methods, conic sections</li>
          <li><strong>Number Theory:</strong> Modular arithmetic, Diophantine equations</li>
        </ul>
        <p><strong>Strategy:</strong> Focus on conceptual understanding, not just formula memorization</p>
      `;
      advancedStrategies = `
        <div class="advanced-strategies">
          <h5>🎯 Mathematical Problem-Solving Mastery:</h5>
          <ul>
            <li><strong>Multiple Approaches:</strong> Solve problems using different methods (algebraic, geometric, calculus)</li>
            <li><strong>Pattern Recognition:</strong> Identify underlying mathematical structures</li>
            <li><strong>Proof Techniques:</strong> Master direct proof, contradiction, induction</li>
            <li><strong>Optimization:</strong> Use calculus for maximum/minimum problems</li>
          </ul>
        </div>
      `;
    } else if (lowerQuery.includes('biology') || lowerQuery.includes('botany') || lowerQuery.includes('zoology')) {
      topicGuidance = 'Advanced Biology';
      specificTips = `
        <h4>🌱 NEET Advanced Biology:</h4>
        <ul>
          <li><strong>Molecular Biology:</strong> DNA replication, transcription, translation mechanisms</li>
          <li><strong>Advanced Physiology:</strong> Hormonal cascades, neural networks, immune responses</li>
          <li><strong>Ecology & Evolution:</strong> Population genetics, speciation, ecosystem dynamics</li>
          <li><strong>Biotechnology:</strong> Genetic engineering, PCR, cloning techniques</li>
        </ul>
        <p><strong>NEET Strategy:</strong> Master NCERT diagrams, understand processes at molecular level</p>
      `;
      advancedStrategies = `
        <div class="advanced-strategies">
          <h5>🎯 Biology Excellence Techniques:</h5>
          <ul>
            <li><strong>Process Integration:</strong> Connect molecular events to physiological outcomes</li>
            <li><strong>Comparative Analysis:</strong> Compare similar processes across different organisms</li>
            <li><strong>Experimental Design:</strong> Understand how biological discoveries were made</li>
            <li><strong>Clinical Connections:</strong> Relate basic biology to medical applications</li>
          </ul>
        </div>
      `;
    } else {
      topicGuidance = 'Elite Preparation Strategy';
      specificTips = `
        <h4>🎯 Top Ranker Preparation Strategy:</h4>
        <ul>
          <li><strong>Conceptual Mastery:</strong> Build deep understanding, not surface knowledge</li>
          <li><strong>Problem Patterns:</strong> Identify and master recurring problem types</li>
          <li><strong>Time Management:</strong> Develop speed with accuracy through practice</li>
          <li><strong>Error Analysis:</strong> Maintain error log, understand mistake patterns</li>
        </ul>
      `;
      advancedStrategies = `
        <div class="advanced-strategies">
          <h5>🏆 Elite Performance Strategies:</h5>
          <ul>
            <li><strong>Multi-Subject Integration:</strong> Solve problems requiring knowledge from multiple subjects</li>
            <li><strong>Advanced Problem Sets:</strong> Practice with Olympiad-level questions</li>
            <li><strong>Conceptual Connections:</strong> Build mental maps linking different topics</li>
            <li><strong>Teaching Others:</strong> Explain concepts to solidify understanding</li>
          </ul>
        </div>
      `;
    }

    return `
      <div class="guidance-result">
        <div class="guidance-header">
          <i class="fas fa-brain"></i>
          <h3>Elite AI Tutor - ${topicGuidance}</h3>
          <span class="provider-badge">Advanced Problem-Solving Mode</span>
        </div>
        
        <div class="guidance-content">
          <div class="query-preview" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1.5rem; border-radius: 12px; margin-bottom: 1.5rem;">
            <strong>🎯 Your Challenge:</strong> "${query}"
            <div style="margin-top: 0.5rem; font-size: 0.9rem; opacity: 0.9;">
              <i class="fas fa-lightbulb"></i> Analyzing with JEE Advanced/NEET level expertise...
            </div>
          </div>
          
          ${specificTips}
          
          ${advancedStrategies}
          
          <div class="elite-study-plan">
            <h4>🏆 Elite 30-Day Mastery Plan</h4>
            <div class="plan-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin: 1.5rem 0;">
              <div class="plan-item" style="display: flex; align-items: center; gap: 1rem; padding: 1.5rem; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(240, 147, 251, 0.3);">
                <div class="plan-icon" style="font-size: 2rem;">🎯</div>
                <div class="plan-text">
                  <strong>Intensive Practice</strong>
                  <p>100+ JEE Advanced level problems daily</p>
                  <small>Focus on multi-concept integration</small>
                </div>
              </div>
              <div class="plan-item" style="display: flex; align-items: center; gap: 1rem; padding: 1.5rem; background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(79, 172, 254, 0.3);">
                <div class="plan-icon" style="font-size: 2rem;">🧠</div>
                <div class="plan-text">
                  <strong>Conceptual Mastery</strong>
                  <p>Deep dive into fundamental principles</p>
                  <small>Build intuitive understanding</small>
                </div>
              </div>
              <div class="plan-item" style="display: flex; align-items: center; gap: 1rem; padding: 1.5rem; background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(67, 233, 123, 0.3);">
                <div class="plan-icon" style="font-size: 2rem;">⚡</div>
                <div class="plan-text">
                  <strong>Speed Building</strong>
                  <p>Timed practice with accuracy focus</p>
                  <small>Develop exam-level speed</small>
                </div>
              </div>
              <div class="plan-item" style="display: flex; align-items: center; gap: 1rem; padding: 1.5rem; background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(250, 112, 154, 0.3);">
                <div class="plan-icon" style="font-size: 2rem;">📈</div>
                <div class="plan-text">
                  <strong>Performance Analysis</strong>
                  <p>Daily mock tests with detailed review</p>
                  <small>Track improvement metrics</small>
                </div>
              </div>
            </div>
          </div>
          
          <div class="problem-solving-framework" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; border-radius: 16px; margin: 2rem 0;">
            <h4 style="margin-bottom: 1rem;"><i class="fas fa-cogs"></i> Elite Problem-Solving Framework</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
              <div style="text-align: center; padding: 1rem;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
                <strong>ANALYZE</strong>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">Break down complex problems into manageable parts</p>
              </div>
              <div style="text-align: center; padding: 1rem;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">🎯</div>
                <strong>STRATEGIZE</strong>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">Choose optimal solution approach</p>
              </div>
              <div style="text-align: center; padding: 1rem;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚡</div>
                <strong>EXECUTE</strong>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">Implement with precision and speed</p>
              </div>
              <div style="text-align: center; padding: 1rem;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">✅</div>
                <strong>VERIFY</strong>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">Check solution and learn from process</p>
              </div>
            </div>
          </div>
          
          <div class="ai-note" style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 2rem; border-radius: 16px; margin-top: 2rem; text-align: center;">
            <i class="fas fa-rocket" style="font-size: 2rem; margin-bottom: 1rem;"></i>
            <p><strong>🚀 Elite Multi-AI System Active!</strong></p>
            <p style="margin: 1rem 0; font-size: 1.1rem;">Cohere + Groq AI working together for JEE Advanced/NEET level problem solving</p>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-top: 1.5rem;">
              <div style="background: rgba(255,255,255,0.2); padding: 1rem; border-radius: 8px;">
                <strong>Cohere</strong><br>
                <small>300+ tokens/sec</small>
              </div>
              <div style="background: rgba(255,255,255,0.2); padding: 1rem; border-radius: 8px;">
                <strong>Groq</strong><br>
                <small>500+ tokens/sec</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }



  // Test AI providers endpoint
  app.post('/api/test-ai-providers', async (req, res) => {
    const results = {};
    
    for (const provider of aiProviders) {
      try {
        console.log(`🧪 Testing ${provider.name}...`);
        const startTime = Date.now();
        
        const testResult = await provider.client.createChatCompletion({
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Say "Hello, I am working!" in exactly those words.' }
          ],
          max_tokens: 20,
          temperature: 0.1
        });
        
        const responseTime = Date.now() - startTime;
        
        if (testResult.choices && testResult.choices[0] && testResult.choices[0].message) {
          results[provider.name] = {
            success: true,
            response: testResult.choices[0].message.content,
            responseTime: responseTime,
            model: provider.model
          };
          console.log(`✅ ${provider.name} test successful`);
        } else {
          results[provider.name] = {
            success: false,
            error: 'Invalid response format',
            responseTime: responseTime
          };
        }
      } catch (error) {
        console.log(`❌ ${provider.name} test failed:`, error.message);
        results[provider.name] = {
          success: false,
          error: error.message
        };
      }
    }
    
    res.json({
      success: true,
      results: results,
      totalProviders: aiProviders.length
    });
  });

  // API status endpoint with rate limit info
  app.get('/api/ai-status', (req, res) => {
    const now = Date.now();
    
    // Calculate key rotation status
    const keyStatus = geminiApiKeys.map((key, index) => {
      const tracking = keyUsageTracking[index];
      const timeSinceReset = now - tracking.lastReset;
      const secondsUntilReset = Math.max(0, Math.ceil((60000 - timeSinceReset) / 1000));
      
      return {
        key_number: index + 1,
        requests_used: tracking.requestCount,
        requests_limit: 15,
        requests_remaining: Math.max(0, 15 - tracking.requestCount),
        is_blocked: tracking.isBlocked && now < tracking.blockUntil,
        resets_in_seconds: secondsUntilReset,
        key_preview: `${key.substring(0, 10)}...${key.substring(key.length - 4)}`
      };
    });
    
    res.json({
      ai_configured: aiProviders.length > 0,
      total_providers: aiProviders.length,
      providers: aiProviders.map(p => ({
        name: p.name,
        model: p.model,
        speed: p.speed,
        priority: p.priority
      })),
      cohere_configured: !!process.env.COHERE_API_KEY,
      gemini_configured: geminiApiKeys.length > 0,
      groq_configured: !!process.env.GROQ_API_KEY,
      gemini_key_rotation: {
        total_keys: geminiApiKeys.length,
        current_key_index: currentKeyIndex + 1,
        keys: keyStatus,
        rotation_enabled: geminiApiKeys.length > 1,
        combined_capacity: `${geminiApiKeys.length * 15} requests per minute`,
        free_tier_limits_per_key: {
          rpm: '15 requests per minute',
          rpd: '1,500 requests per day',
          tpm: '1 million tokens per minute'
        }
      },
      server_time: new Date().toISOString(),
      fallback_mode: aiProviders.length === 0
    });
  });

  // Admin password verification endpoint
  app.post('/api/admin/verify-password', (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sarvesh9925'; // Default password

    if (password === ADMIN_PASSWORD) {
      res.json({
        success: true,
        message: 'Admin access granted',
        token: 'admin-access-token'
      });
    } else {
      res.status(401).json({
        success: false,
        error: 'Invalid admin password'
      });
    }
  });

  // Test API keys endpoint
  app.post('/api/test-ai-keys', async (req, res) => {
    const { groqKey, cohereKey } = req.body;
    const results = {};

    // Test Groq
    if (groqKey) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 10,
            temperature: 0.1
          })
        });

        if (response.ok) {
          const data = await response.json();
          results.groq = { success: true, message: 'Groq API key is valid and working!' };
        } else {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
      } catch (error) {
        results.groq = { success: false, error: error.message };
      }
    }

    // Test Cohere
    if (cohereKey) {
      try {
        const response = await fetch('https://api.cohere.ai/v1/chat', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cohereKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'command-r-08-2024',
            message: 'Test connection',
            max_tokens: 10,
            temperature: 0.1
          })
        });

        if (response.ok) {
          results.cohere = { success: true, message: 'Cohere API key is valid and working!' };
        } else {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
      } catch (error) {
        results.cohere = { success: false, error: error.message };
      }
    }

    // Test with current environment keys if no keys provided
    if (!groqKey && !cohereKey) {
      // Test current Groq key
      if (process.env.GROQ_API_KEY) {
        try {
          const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'llama-3.1-8b-instant',
              messages: [{ role: 'user', content: 'Test' }],
              max_tokens: 5,
              temperature: 0.1
            })
          });

          if (response.ok) {
            results.groq = { success: true, message: 'Current Groq API key is working!' };
          } else {
            const errorText = await response.text();
            results.groq = { success: false, error: `Groq API Error: ${response.status} - ${errorText}` };
          }
        } catch (error) {
          results.groq = { success: false, error: error.message };
        }
      }

      // Test current Cohere key
      if (process.env.COHERE_API_KEY) {
        try {
          const response = await fetch('https://api.cohere.ai/v1/chat', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'command-r-08-2024',
              message: 'Test',
              max_tokens: 5,
              temperature: 0.1
            })
          });

          if (response.ok) {
            results.cohere = { success: true, message: 'Current Cohere API key is working!' };
          } else {
            const errorText = await response.text();
            results.cohere = { success: false, error: `Cohere API Error: ${response.status} - ${errorText}` };
          }
        } catch (error) {
          results.cohere = { success: false, error: error.message };
        }
      }

      // Test current Gemini key
      if (process.env.GEMINI_API_KEY) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: 'Test'
                }]
              }],
              generationConfig: {
                maxOutputTokens: 5
              }
            })
          });

          if (response.ok) {
            results.gemini = { success: true, message: 'Current Gemini API key is working!' };
          } else {
            const errorText = await response.text();
            results.gemini = { success: false, error: `Gemini API Error: ${response.status} - ${errorText}` };
          }
        } catch (error) {
          results.gemini = { success: false, error: error.message };
        }
      }
    }



    res.json(results);
  });



  // Get all questions (no auth required for browsing)
  app.get('/api/questions', async (req, res) => {
    try {
      const { examType, subject, difficulty, chapter, class: classLevel, language } = req.query;
      let query = {};

      // CRITICAL: Always filter by examType to prevent mixing JEE/NEET questions
      if (examType) query.examType = examType;
      if (subject) query.subject = subject;
      if (difficulty) query.difficulty = difficulty;
      if (chapter) query.chapter = chapter;
      if (classLevel) query.class = classLevel;
      
      // Language filter - if specified, filter by language
      // If not specified, show all questions (backward compatibility)
      if (language) {
        query.language = language;
      }

      console.log('🔍 Filtering questions with:', query);

      const questions = await Question.find(query).sort({ createdAt: -1 });

      console.log(`✅ Found ${questions.length} questions for ${examType} ${subject}${language ? ` (${language})` : ''}`);

      res.json({
        success: true,
        questions: questions,
        count: questions.length
      });
    } catch (error) {
      console.error('Error fetching questions:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching questions'
      });
    }
  });

  // Add new question
  app.post('/api/questions', authenticate, async (req, res) => {
    try {
      console.log('📥 Received question data:', JSON.stringify(req.body, null, 2));
      const { examType, subject, class: classLevel, chapter, difficulty, question, tags, enhanced } = req.body;

      // Create question data object
      const questionData = {
        subject,
        class: classLevel,
        chapter,
        difficulty,
        text: question.text,
        options: question.options || [],
        answer: question.answer,
        solution: question.solution,
        explanation: question.explanation || '',
        enhanced: enhanced || false,
        tags: tags || [],
        hints: question.hints || '',
        references: question.references || ''
      };

      const savedQuestions = [];

      // For physics and chemistry, create questions for both JEE and NEET
      if (subject === 'physics' || subject === 'chemistry') {
        console.log(`🔬 Creating ${subject} question for both JEE and NEET`);

        // Create JEE version
        const jeeQuestion = new Question({
          ...questionData,
          examType: 'jee'
        });
        await jeeQuestion.save();
        savedQuestions.push(jeeQuestion);
        console.log('✅ JEE question saved:', jeeQuestion._id);

        // Create NEET version
        const neetQuestion = new Question({
          ...questionData,
          examType: 'neet'
        });
        await neetQuestion.save();
        savedQuestions.push(neetQuestion);
        console.log('✅ NEET question saved:', neetQuestion._id);
      } else {
        console.log(`📚 Creating ${subject} question for ${examType || 'jee'}`);

        // For mathematics and biology, use the specified examType or default to JEE
        const singleQuestion = new Question({
          ...questionData,
          examType: examType || 'jee'
        });
        await singleQuestion.save();
        savedQuestions.push(singleQuestion);
        console.log('✅ Question saved:', singleQuestion._id);
      }

      // Prepare response message
      const message = savedQuestions.length > 1
        ? `Question added successfully for both JEE and NEET (${savedQuestions.length} questions created)`
        : 'Question added successfully';

      res.json({
        success: true,
        message: message,
        questions: savedQuestions,
        question: savedQuestions[0] // For backward compatibility
      });
    } catch (error) {
      console.error('Error adding question:', error);
      res.status(500).json({
        success: false,
        error: 'Error adding question'
      });
    }
  });

  // Bulk add questions endpoint (for admin)
  app.post('/api/questions/bulk-add', authenticate, async (req, res) => {
    try {
      // Admin panel is now password-protected, allow bulk question addition
      console.log('Bulk adding questions via admin panel');

      const { questions } = req.body;

      if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({
          success: false,
          error: 'Questions array is required'
        });
      }

      const result = await Question.insertMany(questions);

      res.json({
        success: true,
        message: `Successfully added ${result.length} questions`,
        addedCount: result.length,
        questions: result
      });
    } catch (error) {
      console.error('Error bulk adding questions:', error);
      res.status(500).json({
        success: false,
        error: 'Error bulk adding questions: ' + error.message
      });
    }
  });

  // Update question
  app.put('/api/questions/:id', authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      const { examType, subject, class: classLevel, chapter, difficulty, question } = req.body;

      const updatedQuestion = await Question.findByIdAndUpdate(id, {
        examType,
        subject,
        class: classLevel,
        chapter,
        difficulty,
        text: question.text,
        options: question.options,
        answer: question.answer,
        solution: question.solution,
        explanation: question.explanation || '',
        lastModified: new Date()
      }, { new: true });

      if (!updatedQuestion) {
        return res.status(404).json({
          success: false,
          error: 'Question not found'
        });
      }

      res.json({
        success: true,
        message: 'Question updated successfully',
        question: updatedQuestion
      });
    } catch (error) {
      console.error('Error updating question:', error);
      res.status(500).json({
        success: false,
        error: 'Error updating question'
      });
    }
  });

  // Delete question
  app.delete('/api/questions/:id', authenticate, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await Question.findByIdAndDelete(id);

      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'Question not found'
        });
      }

      res.json({
        success: true,
        message: 'Question deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting question:', error);
      res.status(500).json({
        success: false,
        error: 'Error deleting question'
      });
    }
  });

  // ========================================
  // MOCK TEST API ENDPOINTS
  // ========================================

  // Create mock test
  app.post('/api/mock-tests', authenticate, async (req, res) => {
    try {
      console.log('📝 ========== CREATING MOCK TEST ==========');
      console.log('📝 Request body:', req.body);
      
      const { name, examType, duration, description, questionIds, totalQuestions, createdBy, isPublic, status } = req.body;

      console.log('📝 Extracted fields:', { name, examType, duration, totalQuestions, status });

      const mockTest = new MockTest({
        name,
        examType,
        duration,
        description,
        questionIds,
        totalQuestions,
        createdBy,
        isPublic: isPublic !== undefined ? isPublic : true,
        status: status || 'active' // Default to 'active' if not provided
      });

      console.log('📝 Mock test object before save:', mockTest);
      
      await mockTest.save();
      
      console.log('✅ Mock test saved successfully!');
      console.log('✅ Saved mock test ID:', mockTest._id);
      console.log('✅ Saved mock test status:', mockTest.status);

      res.json({
        success: true,
        message: 'Mock test created successfully',
        mockTest
      });
    } catch (error) {
      console.error('❌ Error creating mock test:', error);
      res.status(500).json({
        success: false,
        error: 'Error creating mock test: ' + error.message
      });
    }
  });

  // Get all mock tests
  app.get('/api/mock-tests', async (req, res) => {
    try {
      console.log('📊 ========== FETCHING MOCK TESTS ==========');
      
      // First, check ALL mock tests in database (for debugging)
      const allMockTests = await MockTest.find({}).sort({ createdAt: -1 });
      console.log('📊 Total mock tests in database (all statuses):', allMockTests.length);
      
      if (allMockTests.length > 0) {
        console.log('📊 All mock tests:');
        allMockTests.forEach((test, index) => {
          console.log(`   ${index + 1}. ${test.name} - Status: ${test.status} - ID: ${test._id}`);
        });
      }
      
      // Now get only active ones
      const mockTests = await MockTest.find({ status: 'active' }).sort({ createdAt: -1 });
      
      console.log('📊 Active mock tests:', mockTests.length);
      if (mockTests.length > 0) {
        console.log('📊 First active mock test:', {
          id: mockTests[0]._id,
          name: mockTests[0].name,
          status: mockTests[0].status,
          examType: mockTests[0].examType
        });
      } else {
        console.log('⚠️ No active mock tests found!');
        if (allMockTests.length > 0) {
          console.log('⚠️ But there are', allMockTests.length, 'mock tests with other statuses');
        }
      }

      res.json({
        success: true,
        mockTests
      });
    } catch (error) {
      console.error('❌ Error fetching mock tests:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching mock tests'
      });
    }
  });

  // Get single mock test by ID
  app.get('/api/mock-tests/:id', async (req, res) => {
    try {
      const mockTest = await MockTest.findById(req.params.id).populate('questionIds');

      if (!mockTest) {
        return res.status(404).json({
          success: false,
          error: 'Mock test not found'
        });
      }

      res.json({
        success: true,
        mockTest
      });
    } catch (error) {
      console.error('Error fetching mock test:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching mock test'
      });
    }
  });

  // Delete mock test
  app.delete('/api/mock-tests/:id', authenticate, async (req, res) => {
    try {
      const result = await MockTest.findByIdAndDelete(req.params.id);

      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'Mock test not found'
        });
      }

      res.json({
        success: true,
        message: 'Mock test deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting mock test:', error);
      res.status(500).json({
        success: false,
        error: 'Error deleting mock test'
      });
    }
  });

  // ========================================
  // TEST RESULTS API ENDPOINTS
  // ========================================

  // Save test result
  app.post('/api/test-results', authenticate, async (req, res) => {
    try {
      const { testId, mockTestId, testTitle, testType, answers, score, totalMarks, maxMarks, totalQuestions, correct, incorrect, unanswered, percentage, timeSpent, hasNegativeMarking } = req.body;

      const testResult = new TestResult({
        userId: req.user._id,
        username: req.user.username,
        testId,
        mockTestId,
        testTitle,
        testType,
        answers,
        score,
        totalMarks,
        maxMarks,
        totalQuestions,
        correct,
        incorrect,
        unanswered,
        percentage,
        timeSpent,
        hasNegativeMarking
      });

      await testResult.save();

      res.json({
        success: true,
        testResult
      });
    } catch (error) {
      console.error('Error saving test result:', error);
      res.status(500).json({
        success: false,
        error: 'Error saving test result'
      });
    }
  });

  // Get all test results for a user
  app.get('/api/test-results/user/:userId', authenticate, async (req, res) => {
    try {
      const results = await TestResult.find({ userId: req.params.userId })
        .sort({ timestamp: -1 })
        .limit(50);

      res.json({
        success: true,
        results
      });
    } catch (error) {
      console.error('Error fetching test results:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching test results'
      });
    }
  });

  // Get all test results (for admin/teacher to view all students' performance)
  app.get('/api/test-results/all', authenticate, async (req, res) => {
    try {
      const results = await TestResult.find({})
        .sort({ timestamp: -1 })
        .limit(500);

      // Populate username from User collection
      const resultsWithUsernames = await Promise.all(
        results.map(async (result) => {
          const user = await User.findById(result.userId);
          return {
            ...result.toObject(),
            username: user ? user.username : 'Unknown'
          };
        })
      );

      res.json({
        success: true,
        results: resultsWithUsernames
      });
    } catch (error) {
      console.error('Error fetching all test results:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching test results'
      });
    }
  });

  // Get all test results for a specific mock test (admin only)
  app.get('/api/test-results/mock/:mockTestId', authenticate, async (req, res) => {
    try {
      const results = await TestResult.find({ mockTestId: req.params.mockTestId })
        .populate('userId', 'username email')
        .sort({ percentage: -1, timestamp: -1 });

      res.json({
        success: true,
        results
      });
    } catch (error) {
      console.error('Error fetching mock test results:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching mock test results'
      });
    }
  });

  // Get all test results (admin only - for performance tab)
  app.get('/api/test-results', authenticate, async (req, res) => {
    try {
      const results = await TestResult.find()
        .populate('userId', 'username email')
        .sort({ timestamp: -1 })
        .limit(100);

      res.json({
        success: true,
        results
      });
    } catch (error) {
      console.error('Error fetching all test results:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching test results'
      });
    }
  });

  // ========================================
  // PRACTICE TEST API ENDPOINTS
  // ========================================

  // Create practice test
  app.post('/api/practice-tests', authenticate, async (req, res) => {
    try {
      const { name, examType, subject, difficulty, questionCount, duration, selectionMode, questionIds } = req.body;
      
      console.log('📝 Creating practice test:', name);
      
      const practiceTest = new PracticeTest({
        name,
        examType,
        subject,
        difficulty,
        questionCount,
        duration: duration || 60,
        selectionMode: selectionMode || 'auto',
        questionIds,
        createdBy: req.user._id
      });
      
      await practiceTest.save();
      
      console.log('✅ Practice test created:', practiceTest._id);
      
      res.json({ 
        success: true, 
        test: practiceTest,
        message: 'Practice test created successfully'
      });
    } catch (error) {
      console.error('❌ Error creating practice test:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Get personal tests (only for current user)
  app.get('/api/practice-tests/my-tests', authenticate, async (req, res) => {
    try {
      const tests = await PracticeTest.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
      
      console.log(`📊 Fetched ${tests.length} personal tests for user ${req.user._id}`);
      
      res.json({ 
        success: true, 
        tests 
      });
    } catch (error) {
      console.error('❌ Error fetching personal tests:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Get all practice tests
  app.get('/api/practice-tests', async (req, res) => {
    try {
      const tests = await PracticeTest.find().sort({ createdAt: -1 });
      
      console.log(`📊 Fetched ${tests.length} practice tests`);
      
      res.json({ 
        success: true, 
        tests 
      });
    } catch (error) {
      console.error('❌ Error fetching practice tests:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Get single practice test by ID with questions
  app.get('/api/practice-tests/:id', async (req, res) => {
    try {
      const test = await PracticeTest.findById(req.params.id).populate('questionIds');
      
      if (!test) {
        return res.status(404).json({
          success: false,
          error: 'Practice test not found'
        });
      }
      
      res.json({
        success: true,
        test: {
          ...test.toObject(),
          questions: test.questionIds
        }
      });
    } catch (error) {
      console.error('❌ Error fetching practice test:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Delete practice test
  app.delete('/api/practice-tests/:id', authenticate, async (req, res) => {
    try {
      const result = await PracticeTest.findByIdAndDelete(req.params.id);
      
      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'Practice test not found'
        });
      }
      
      console.log('✅ Practice test deleted:', req.params.id);
      
      res.json({
        success: true,
        message: 'Practice test deleted successfully'
      });
    } catch (error) {
      console.error('❌ Error deleting practice test:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Get questions by IDs (for displaying selected questions)
  app.post('/api/questions/by-ids', async (req, res) => {
    try {
      const { ids } = req.body;
      const questions = await Question.find({ _id: { $in: ids } });

      res.json({
        success: true,
        questions
      });
    } catch (error) {
      console.error('Error fetching questions by IDs:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching questions'
      });
    }
  });

  // Chapter Management API Endpoints

  // Get all chapters for a specific exam type and subject
  app.get('/api/chapters', async (req, res) => {
    try {
      const { examType, subject } = req.query;
      let query = { isActive: true };

      // For Physics and Chemistry, share chapters between JEE and NEET
      if (subject === 'physics' || subject === 'chemistry') {
        // Get chapters for both JEE and NEET for this subject
        query.$or = [
          { examType: 'jee', subject: subject },
          { examType: 'neet', subject: subject }
        ];
      } else {
        // For other subjects (like Mathematics for JEE, Biology for NEET), filter by examType
        if (examType) query.examType = examType;
        if (subject) query.subject = subject;
      }

      const chapters = await Chapter.find(query).sort({ order: 1, name: 1 });

      // Remove duplicates by name (in case same chapter exists for both JEE and NEET)
      const uniqueChapters = [];
      const seenNames = new Set();

      for (const chapter of chapters) {
        if (!seenNames.has(chapter.name.toLowerCase())) {
          seenNames.add(chapter.name.toLowerCase());
          uniqueChapters.push(chapter);
        }
      }

      res.json({
        success: true,
        chapters: uniqueChapters
      });
    } catch (error) {
      console.error('Error fetching chapters:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching chapters'
      });
    }
  });

  // Add new chapter
  app.post('/api/chapters', authenticate, async (req, res) => {
    try {
      const { examType, subject, name, description, icon, order } = req.body;

      if (!examType || !subject || !name) {
        return res.status(400).json({
          success: false,
          error: 'Exam type, subject, and chapter name are required'
        });
      }

      const createdChapters = [];

      // For Physics and Chemistry, create chapters for both JEE and NEET
      if (subject === 'physics' || subject === 'chemistry') {
        const examTypes = ['jee', 'neet'];

        for (const currentExamType of examTypes) {
          // Check if chapter already exists for this exam type
          const existingChapter = await Chapter.findOne({
            examType: currentExamType,
            subject,
            name
          });

          if (!existingChapter) {
            const newChapter = new Chapter({
              examType: currentExamType,
              subject,
              name,
              description: description || '',
              icon: icon || 'fa-book',
              order: order || 0,
              createdBy: req.user._id
            });

            await newChapter.save();
            createdChapters.push(newChapter);
          }
        }

        if (createdChapters.length === 0) {
          return res.status(409).json({
            success: false,
            error: 'Chapter already exists for both JEE and NEET'
          });
        }

        res.json({
          success: true,
          message: `Chapter added successfully for ${createdChapters.map(c => c.examType.toUpperCase()).join(' and ')}`,
          chapters: createdChapters,
          chapter: createdChapters[0] // Return first chapter for compatibility
        });

      } else {
        // For other subjects (Mathematics, Biology), create only for the specified exam type
        const existingChapter = await Chapter.findOne({ examType, subject, name });
        if (existingChapter) {
          return res.status(409).json({
            success: false,
            error: 'Chapter already exists for this subject'
          });
        }

        const newChapter = new Chapter({
          examType,
          subject,
          name,
          description: description || '',
          icon: icon || 'fa-book',
          order: order || 0,
          createdBy: req.user._id
        });

        await newChapter.save();

        res.json({
          success: true,
          message: 'Chapter added successfully',
          chapter: newChapter
        });
      }
    } catch (error) {
      console.error('Error adding chapter:', error);
      res.status(500).json({
        success: false,
        error: 'Error adding chapter'
      });
    }
  });

  // Update chapter
  app.put('/api/chapters/:id', authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, icon, order, isActive } = req.body;

      const updatedChapter = await Chapter.findByIdAndUpdate(id, {
        name,
        description,
        icon,
        order,
        isActive
      }, { new: true });

      if (!updatedChapter) {
        return res.status(404).json({
          success: false,
          error: 'Chapter not found'
        });
      }

      res.json({
        success: true,
        message: 'Chapter updated successfully',
        chapter: updatedChapter
      });
    } catch (error) {
      console.error('Error updating chapter:', error);
      res.status(500).json({
        success: false,
        error: 'Error updating chapter'
      });
    }
  });

  // Delete chapter
  app.delete('/api/chapters/:id', authenticate, async (req, res) => {
    try {
      const { id } = req.params;

      // Check if there are questions using this chapter
      const questionsCount = await Question.countDocuments({ chapter: { $exists: true } });

      // For now, we'll do a soft delete by setting isActive to false
      const updatedChapter = await Chapter.findByIdAndUpdate(id, {
        isActive: false
      }, { new: true });

      if (!updatedChapter) {
        return res.status(404).json({
          success: false,
          error: 'Chapter not found'
        });
      }

      res.json({
        success: true,
        message: 'Chapter deleted successfully',
        chapter: updatedChapter
      });
    } catch (error) {
      console.error('Error deleting chapter:', error);
      res.status(500).json({
        success: false,
        error: 'Error deleting chapter'
      });
    }
  });

  // Clear all chapters for a subject (admin only)
  app.delete('/api/chapters/clear', authenticate, async (req, res) => {
    try {
      const { examType, subject } = req.query;

      let query = {};
      if (examType) query.examType = examType;
      if (subject) query.subject = subject;

      const result = await Chapter.updateMany(query, { isActive: false });

      res.json({
        success: true,
        message: `Successfully cleared chapters. Updated ${result.modifiedCount} chapters.`,
        modifiedCount: result.modifiedCount
      });
    } catch (error) {
      console.error('Error clearing chapters:', error);
      res.status(500).json({
        success: false,
        error: 'Error clearing chapters'
      });
    }
  });

  // Clear ALL chapters from database (admin only)
  app.delete('/api/admin/chapters/clear-all', authenticate, async (req, res) => {
    try {
      const result = await Chapter.deleteMany({});

      res.json({
        success: true,
        message: `Successfully deleted all chapters. Deleted ${result.deletedCount} chapters.`,
        deletedCount: result.deletedCount
      });
    } catch (error) {
      console.error('Error clearing all chapters:', error);
      res.status(500).json({
        success: false,
        error: 'Error clearing all chapters'
      });
    }
  });

  // Clear ALL questions from database (admin only)
  app.delete('/api/admin/questions/clear-all', authenticate, async (req, res) => {
    try {
      const result = await Question.deleteMany({});

      res.json({
        success: true,
        message: `Successfully deleted all questions. Deleted ${result.deletedCount} questions.`,
        deletedCount: result.deletedCount
      });
    } catch (error) {
      console.error('Error clearing all questions:', error);
      res.status(500).json({
        success: false,
        error: 'Error clearing all questions'
      });
    }
  });











  // Admin-only endpoints

  // Get all users (password protected)
  app.get('/api/admin/users', authenticate, async (req, res) => {
    try {
      // Admin panel is now password-protected, no role check needed

      const users = await User.find({}, 'username email role createdAt').sort({ createdAt: -1 });

      res.json({
        success: true,
        users: users
      });
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching users'
      });
    }
  });

  // Delete user (password protected)
  app.delete('/api/admin/users/:id', authenticate, async (req, res) => {
    try {
      // Admin panel is now password-protected, no role check needed

      const { id } = req.params;
      const result = await User.findByIdAndDelete(id);

      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      res.json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({
        success: false,
        error: 'Error deleting user'
      });
    }
  });

  // Bulk fetch questions by IDs (for paper generation)
  app.post('/api/questions/bulk', async (req, res) => {
    try {
      const { questionIds } = req.body;
      
      if (!questionIds || !Array.isArray(questionIds)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid question IDs'
        });
      }

      const questions = await Question.find({ _id: { $in: questionIds } });
      
      res.json(questions);
    } catch (error) {
      console.error('Error fetching bulk questions:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching questions'
      });
    }
  });

  // ==================== PAPER CONFIGURATION ENDPOINTS ====================
  
  // Save paper configuration (without PDF)
  app.post('/api/paper-configs', async (req, res) => {
    try {
      console.log('📝 Saving paper config:', req.body);
      
      // Get user ID from token or use a default
      let userId;
      try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token && token !== 'admin-token' && token !== 'student-token') {
          const decoded = jwt.verify(token, JWT_SECRET);
          userId = decoded.userId;
        } else {
          // Use a default user for demo
          const defaultUser = await User.findOne({ username: 'student' });
          userId = defaultUser ? defaultUser._id : new mongoose.Types.ObjectId();
        }
      } catch (err) {
        // Use a default user for demo
        const defaultUser = await User.findOne({ username: 'student' });
        userId = defaultUser ? defaultUser._id : new mongoose.Types.ObjectId();
      }

      const paperConfig = new PaperConfig({
        userId,
        ...req.body
      });

      await paperConfig.save();
      
      console.log('✅ Paper config saved:', paperConfig._id);
      
      res.json({
        success: true,
        message: 'Paper configuration saved successfully',
        paperConfig
      });
    } catch (error) {
      console.error('❌ Error saving paper config:', error);
      res.status(500).json({
        success: false,
        error: 'Error saving paper configuration: ' + error.message
      });
    }
  });

  // Get all paper configurations for a user
  app.get('/api/paper-configs', authenticate, async (req, res) => {
    try {
      const paperConfigs = await PaperConfig.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .populate('questionIds', 'text difficulty chapter');

      res.json({
        success: true,
        paperConfigs
      });
    } catch (error) {
      console.error('Error fetching paper configs:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching paper configurations'
      });
    }
  });

  // Get single paper configuration by ID
  app.get('/api/paper-configs/:id', authenticate, async (req, res) => {
    try {
      const paperConfig = await PaperConfig.findOne({
        _id: req.params.id,
        userId: req.user._id
      }).populate('questionIds');

      if (!paperConfig) {
        return res.status(404).json({
          success: false,
          error: 'Paper configuration not found'
        });
      }

      res.json({
        success: true,
        paperConfig
      });
    } catch (error) {
      console.error('Error fetching paper config:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching paper configuration'
      });
    }
  });

  // Update paper configuration
  app.put('/api/paper-configs/:id', authenticate, async (req, res) => {
    try {
      const paperConfig = await PaperConfig.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id },
        { ...req.body, lastGenerated: new Date() },
        { new: true }
      );

      if (!paperConfig) {
        return res.status(404).json({
          success: false,
          error: 'Paper configuration not found'
        });
      }

      res.json({
        success: true,
        message: 'Paper configuration updated successfully',
        paperConfig
      });
    } catch (error) {
      console.error('Error updating paper config:', error);
      res.status(500).json({
        success: false,
        error: 'Error updating paper configuration'
      });
    }
  });

  // Delete paper configuration
  app.delete('/api/paper-configs/:id', authenticate, async (req, res) => {
    try {
      const paperConfig = await PaperConfig.findOneAndDelete({
        _id: req.params.id,
        userId: req.user._id
      });

      if (!paperConfig) {
        return res.status(404).json({
          success: false,
          error: 'Paper configuration not found'
        });
      }

      res.json({
        success: true,
        message: 'Paper configuration deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting paper config:', error);
      res.status(500).json({
        success: false,
        error: 'Error deleting paper configuration'
      });
    }
  });

  // ==================== PUPPETEER PDF GENERATION WITH AUTO-CLEANUP ====================
  
  // Generate PDF using Playwright (server-side) - Questions, Answer Key, Solutions
  app.post('/api/generate-pdf', authenticate, async (req, res) => {
    let browser = null;
    try {
      const { paperConfigId, pdfType, questions, config } = req.body;
      
      console.log('🚀 Starting Playwright PDF generation...');
      console.log('📄 PDF Type:', pdfType);
      console.log('📋 Paper Config ID:', paperConfigId);
      console.log('📊 Questions count:', questions?.length);
      
      if (!questions || !config || !pdfType) {
        return res.status(400).json({
          success: false,
          error: 'Questions, config, and pdfType are required'
        });
      }

      // Validate PDF type
      if (!['questions', 'answerkey', 'solutions'].includes(pdfType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid PDF type. Must be: questions, answerkey, or solutions'
        });
      }

      // Create temp directory
      const tempDir = path.join(__dirname, 'temp_pdfs');
      await fs.mkdir(tempDir, { recursive: true });

      // Generate filename
      const timestamp = Date.now();
      const filename = `${config.schoolName || 'GYANMANJARI'}_${config.paperTitle || 'MOCK'}_${pdfType}_${timestamp}.pdf`;
      const filepath = path.join(tempDir, filename);

      console.log('📁 Saving to:', filepath);

      // Launch Playwright browser
      console.log('🌐 Launching Playwright browser...');
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });

      const context = await browser.newContext();
      const page = await context.newPage();

      // Generate HTML based on PDF type
      const html = generatePaperHTML(questions, config, pdfType);
      
      // Set content
      console.log('📝 Setting HTML content...');
      await page.setContent(html, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Wait for MathJax to render
      console.log('⏳ Waiting for MathJax to render LaTeX...');
      await page.waitForTimeout(2000); // Wait 2 seconds for MathJax
      
      // Check if MathJax is ready
      await page.evaluate(() => {
        return new Promise((resolve) => {
          if (window.MathJax && window.MathJax.startup) {
            window.MathJax.startup.promise.then(() => resolve());
          } else {
            setTimeout(() => resolve(), 1000);
          }
        });
      });

      // Generate PDF
      console.log('🖨️ Generating PDF...');
      await page.pdf({
        path: filepath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '15mm',
          right: '15mm',
          bottom: '15mm',
          left: '15mm'
        }
      });

      await browser.close();
      browser = null;
      console.log('✅ PDF generated successfully!');

      // Send PDF file and delete after sending
      res.download(filepath, filename, async (err) => {
        if (err) {
          console.error('❌ Error sending PDF:', err);
        }
        
        // Delete the temporary file after sending
        try {
          await fs.unlink(filepath);
          console.log('🗑️ Temporary PDF file deleted:', filename);
        } catch (deleteErr) {
          console.error('⚠️ Error deleting temporary PDF:', deleteErr);
        }
      });

    } catch (error) {
      console.error('❌ PDF generation error:', error);
      if (browser) {
        await browser.close();
      }
      res.status(500).json({
        success: false,
        error: 'PDF generation failed: ' + error.message
      });
    }
  });

  // Helper function to convert LaTeX to Unicode (basic fallback)
  function convertLatexToText(text) {
    if (!text) return '';
    return text
      .replace(/\$\$(.*?)\$\$/g, '$1')
      .replace(/\$(.*?)\$/g, '$1')
      .replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β').replace(/\\gamma/g, 'γ')
      .replace(/\\delta/g, 'δ').replace(/\\theta/g, 'θ').replace(/\\pi/g, 'π')
      .replace(/\\Delta/g, 'Δ').replace(/\\Sigma/g, 'Σ').replace(/\\Omega/g, 'Ω')
      .replace(/\\times/g, '×').replace(/\\div/g, '÷').replace(/\\pm/g, '±')
      .replace(/\\cdot/g, '·').replace(/\\approx/g, '≈').replace(/\\neq/g, '≠')
      .replace(/\\leq/g, '≤').replace(/\\geq/g, '≥').replace(/\\infty/g, '∞')
      .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1/$2)')
      .replace(/\\sqrt\{([^}]+)\}/g, '√$1')
      .replace(/\^{([^}]+)}/g, '^$1')
      .replace(/_{([^}]+)}/g, '_$1')
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/[{}]/g, '');
  }

  // Helper function to escape HTML and preserve formatting
  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Helper function to generate HTML for different PDF types
  function generatePaperHTML(questions, config, type) {
    const schoolName = config.schoolName || 'GYANMANJARI';
    const paperTitle = config.paperTitle || 'MOCK_12-11';
    const subject = config.subject || 'Physics';
    const standard = config.standard || '11';
    const totalMarks = config.totalMarks || '100';
    const paperSet = config.paperSet || '1';
    const examDate = config.examDate ? new Date(config.examDate).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
    const examTime = config.examTime || '0H:0M';

    let typeLabel = '';
    if (type === 'questions') typeLabel = '';
    else if (type === 'answerkey') typeLabel = '(Answer Key)';
    else if (type === 'solutions') typeLabel = '(Solutions)';

    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script>
    window.MathJax = {
      tex: {
        inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
        displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
        processEscapes: true
      },
      svg: {
        fontCache: 'global'
      }
    };
  </script>
  <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;500;600;700&display=swap">
  <style>
    /* Gujarati Font Support */
    @font-face {
      font-family: 'EKLG-13-BoldItalic';
      src: url('https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@700&display=swap');
      font-weight: bold;
      font-style: italic;
    }
    
    .gujarati-text,
    .lang-gu,
    [lang="gu"] {
      font-family: 'Noto Sans Gujarati', 'EKLG-13-BoldItalic', sans-serif !important;
    }
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 9pt; line-height: 1.4; white-space: pre-wrap; padding: 10mm; }
    
    /* Compact Header Design */
    .header { 
      border: 2px solid #000; 
      padding: 10px 15px; 
      margin-bottom: 8px; 
    }
    .school-name { 
      font-size: 24pt; 
      font-weight: bold; 
      text-align: center; 
      margin-bottom: 8px; 
      line-height: 0.6; 
    }
    .header-info { 
      display: flex; 
      justify-content: space-between; 
      align-items: flex-start;
      font-size: 10pt;
      line-height: 0.6;
    }
    .header-left { 
      text-align: left; 
      flex: 1;
      line-height: 0.6;
    }
    .header-center { 
      text-align: center; 
      flex: 1;
      font-size: 18pt; 
      font-weight: bold;
      padding: 0 15px;
      line-height: 0.6;
    }
    .header-right { 
      text-align: right; 
      flex: 1;
      line-height: 0.6;
    }
    .info-line { 
      margin: 0; 
      line-height: 0.6;
    }
    .info-label { 
      font-weight: bold; 
    }
    
    .section-title { 
      border: 2px dashed #000; 
      padding: 4px 10px; 
      display: inline-block; 
      margin: 8px 0 10px 0; 
      font-weight: bold; 
      font-size: 10pt; 
    }
    
    /* Two-column layout for questions */
    .two-column { column-count: 2; column-gap: 15px; column-rule: 1px solid #ddd; }
    .question { margin: 8px 0; page-break-inside: avoid; break-inside: avoid; font-size: 9.5pt; }
    .question-text { margin-bottom: 5px; line-height: 1.5; white-space: pre-wrap; }
    .options { margin-left: 15px; margin-top: 3px; }
    .option { margin: 3px 0; white-space: pre-wrap; }
    .solution { margin: 8px 0 8px 15px; color: #1976d2; font-style: italic; font-size: 9pt; white-space: pre-wrap; line-height: 1.5; }
    .solution-label { font-weight: bold; color: #000; }
    .correct-answer { color: #4caf50; font-weight: bold; }
    .answer-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    .answer-table td { border: 1px solid #000; padding: 6px; text-align: center; font-size: 9pt; }
    img { max-width: 250px; max-height: 200px; height: auto; margin: 5px 0; display: block; }
    .text-left { text-align: left !important; }
    .text-center { text-align: center !important; }
    .text-right { text-align: right !important; }
    br { display: block; margin: 0.5em 0; content: ""; }
  </style>
</head>
<body>
  <div class="header">
    <div class="school-name">${schoolName}</div>
    <div class="header-info">
      <div class="header-left">
        <div class="info-line"><span class="info-label">Subject</span> : ${subject}</div>
        <div class="info-line"><span class="info-label">Standard</span> : ${standard}</div>
        <div class="info-line"><span class="info-label">Total Mark</span> : ${totalMarks}</div>
      </div>
      <div class="header-center">
        ${paperTitle}${typeLabel ? ` ${typeLabel}` : ''}
      </div>
      <div class="header-right">
        <div class="info-line"><span class="info-label">Paper Set</span> : ${paperSet}</div>
        <div class="info-line"><span class="info-label">Date</span> : ${examDate}</div>
        <div class="info-line"><span class="info-label">Time</span> : ${examTime}</div>
      </div>
    </div>
  </div>
`;

    if (type === 'answerkey') {
      // Answer Key Format - Table layout
      html += `<div class="section-title">${subject} - Section A (MCQ)</div>`;
      html += `<table class="answer-table"><tr>`;
      
      questions.forEach((q, index) => {
        const qNum = index + 1;
        const answer = q.answer || q.correctAnswer || 'N/A';
        
        html += `<td><strong>${qNum}</strong> : ${answer}</td>`;
        
        // 10 answers per row
        if ((index + 1) % 10 === 0 && index < questions.length - 1) {
          html += `</tr><tr>`;
        }
      });
      
      html += `</tr></table>`;
      
    } else {
      // Questions or Solutions Format
      html += `<div class="section-title">${subject} - Section A (MCQ)</div>`;
      html += `<div class="two-column">`;
      
      questions.forEach((q, index) => {
        const qNum = index + 1;
        const questionText = q.text || q.question || '';
        const options = q.options || [];
        const correctAnswer = q.answer || q.correctAnswer || '';
        const solution = q.solution || q.explanation || '';
        
        html += `<div class="question">`;
        html += `<div class="question-text"><strong>(${qNum})</strong> ${questionText}</div>`;
        
        // Question image
        if (q.image || q.questionImage) {
          html += `<img src="${q.image || q.questionImage}" alt="Question ${qNum}" style="max-width: 250px; max-height: 200px; height: auto; margin: 5px 0;">`;
        }
        
        // Options
        if (options.length > 0) {
          html += `<div class="options">`;
          options.forEach((opt, optIndex) => {
            const label = String.fromCharCode(65 + optIndex); // A, B, C, D
            const isCorrect = type === 'solutions' && correctAnswer === label;
            const optClass = isCorrect ? 'option correct-answer' : 'option';
            html += `<div class="${optClass}"><strong>(${label})</strong> ${opt}</div>`;
          });
          html += `</div>`;
        }
        
        // Solution (only for solutions type)
        if (type === 'solutions' && solution) {
          html += `<div class="solution">`;
          html += `<span class="solution-label">Solution:(Correct Answer:${correctAnswer})</span><br>`;
          html += solution;
          html += `</div>`;
        }
        
        html += `</div>`;
      });
      
      html += `</div>`; // Close two-column div
    }

    html += `</body></html>`;
    return html;
  }

  // Get user's generated PDFs
  app.get('/api/generated-pdfs', authenticate, async (req, res) => {
    try {
      const pdfs = await GeneratedPDF.find({
        userId: req.user._id,
        status: 'active',
        expiresAt: { $gt: new Date() }
      }).sort({ createdAt: -1 });

      res.json({
        success: true,
        pdfs
      });
    } catch (error) {
      console.error('Error fetching PDFs:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching PDFs'
      });
    }
  });

  // Download a generated PDF
  app.get('/api/generated-pdfs/:id/download', authenticate, async (req, res) => {
    try {
      const pdf = await GeneratedPDF.findOne({
        _id: req.params.id,
        userId: req.user._id,
        status: 'active'
      });

      if (!pdf) {
        return res.status(404).json({
          success: false,
          error: 'PDF not found or expired'
        });
      }

      // Check if file still exists
      try {
        await fs.access(pdf.filepath);
        res.download(pdf.filepath, pdf.filename);
      } catch (err) {
        // File doesn't exist, mark as deleted
        pdf.status = 'deleted';
        await pdf.save();
        
        return res.status(404).json({
          success: false,
          error: 'PDF file not found'
        });
      }
    } catch (error) {
      console.error('Error downloading PDF:', error);
      res.status(500).json({
        success: false,
        error: 'Error downloading PDF'
      });
    }
  });

  // Cleanup function - Delete expired PDFs
  async function cleanupExpiredPDFs() {
    try {
      console.log('🧹 Running PDF cleanup...');
      
      const expiredPDFs = await GeneratedPDF.find({
        status: 'active',
        expiresAt: { $lt: new Date() }
      });

      console.log(`📋 Found ${expiredPDFs.length} expired PDFs`);

      for (const pdf of expiredPDFs) {
        try {
          // Delete file from filesystem
          await fs.unlink(pdf.filepath);
          console.log(`🗑️ Deleted file: ${pdf.filename}`);
        } catch (err) {
          console.log(`⚠️ File already deleted: ${pdf.filename}`);
        }

        // Update database record
        pdf.status = 'deleted';
        await pdf.save();
      }

      console.log('✅ PDF cleanup completed');
    } catch (error) {
      console.error('❌ Error during PDF cleanup:', error);
    }
  }

  // Run cleanup every 5 minutes
  setInterval(cleanupExpiredPDFs, 5 * 60 * 1000);
  console.log('⏰ PDF cleanup cron job started (runs every 5 minutes)');

  // Run cleanup on startup
  setTimeout(cleanupExpiredPDFs, 10000); // Run after 10 seconds

  // Generate PDF on-demand from paper configuration
  app.get('/api/paper-configs/:id/generate/:type', async (req, res) => {
    try {
      const { id, type } = req.params;
      
      console.log('📄 Generate PDF request:', { id, type });
      
      // Validate type
      if (!['questions', 'answers', 'solutions'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid PDF type. Must be: questions, answers, or solutions'
        });
      }

      // Load paper config with populated questions (without user check for now)
      const paperConfig = await PaperConfig.findById(id).populate('questionIds');

      if (!paperConfig) {
        console.error('❌ Paper config not found:', id);
        return res.status(404).json({
          success: false,
          error: 'Paper configuration not found'
        });
      }

      console.log('✅ Found paper config:', paperConfig.paperName);
      console.log('📋 Questions count:', paperConfig.questionIds?.length || 0);

      // Update last generated timestamp
      paperConfig.lastGenerated = new Date();
      await paperConfig.save();

      // Return paper config with questions for frontend PDF generation
      res.json({
        success: true,
        paperConfig,
        type,
        message: 'Paper data ready for PDF generation'
      });
    } catch (error) {
      console.error('❌ Error generating PDF:', error);
      res.status(500).json({
        success: false,
        error: 'Error generating PDF: ' + error.message
      });
    }
  });

  // Get system statistics (password protected)
  app.get('/api/admin/stats', authenticate, async (req, res) => {
    try {
      // Admin panel is now password-protected, no role check needed

      const totalUsers = await User.countDocuments();
      const totalStudents = await User.countDocuments({ role: 'student' });
      const totalTeachers = await User.countDocuments({ role: 'teacher' });
      const totalAdmins = await User.countDocuments({ role: 'admin' });
      const totalQuestions = await Question.countDocuments();
      const totalTests = await Test.countDocuments();

      res.json({
        success: true,
        stats: {
          totalUsers,
          totalStudents,
          totalTeachers,
          totalAdmins,
          totalQuestions,
          totalTests
        }
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching statistics'
      });
    }
  });

  // Clear all questions (password protected)
  app.delete('/api/admin/questions/clear', authenticate, async (req, res) => {
    try {
      // Admin panel is now password-protected, no role check needed

      const result = await Question.deleteMany({});

      res.json({
        success: true,
        message: `Successfully cleared all questions. Deleted ${result.deletedCount} questions.`,
        deletedCount: result.deletedCount
      });
    } catch (error) {
      console.error('Error clearing questions:', error);
      res.status(500).json({
        success: false,
        error: 'Error clearing questions'
      });
    }
  });

  // Get user performance data
  app.get('/api/performance/:userId', authenticate, async (req, res) => {
    try {
      const { userId } = req.params;

      // Users can access their own performance data, admin panel users can access any
      if (req.user._id.toString() !== userId) {
        // Allow access if user has admin panel access (password-based)
        console.log('Admin panel user accessing performance data for:', userId);
      }

      const testResults = await TestResult.find({ userId }).sort({ timestamp: -1 });

      // Calculate performance metrics
      const totalTests = testResults.length;
      const averageScore = totalTests > 0 ?
        testResults.reduce((sum, result) => sum + result.percentage, 0) / totalTests : 0;

      const subjectPerformance = {};
      testResults.forEach(result => {
        const subject = result.testTitle.split(' - ')[0] || 'Unknown';
        if (!subjectPerformance[subject]) {
          subjectPerformance[subject] = { total: 0, sum: 0 };
        }
        subjectPerformance[subject].total++;
        subjectPerformance[subject].sum += result.percentage;
      });

      Object.keys(subjectPerformance).forEach(subject => {
        subjectPerformance[subject].average =
          subjectPerformance[subject].sum / subjectPerformance[subject].total;
      });

      res.json({
        success: true,
        performance: {
          totalTests,
          averageScore: Math.round(averageScore),
          recentTests: testResults.slice(0, 10),
          subjectPerformance
        }
      });
    } catch (error) {
      console.error('Error fetching performance data:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching performance data'
      });
    }
  });

  // ========================================
  // EMBEDDED DOCUMENTS API ENDPOINTS
  // ========================================

  // Get all embedded documents
  app.get('/api/embedded-documents', async (req, res) => {
    try {
      const { stream, subject } = req.query;
      let query = { isActive: true };

      if (stream) query.stream = stream;
      if (subject) query.subject = subject;

      const documents = await EmbeddedDocument.find(query).sort({ createdAt: -1 });

      res.json({
        success: true,
        documents,
        count: documents.length
      });
    } catch (error) {
      console.error('Error fetching embedded documents:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching embedded documents'
      });
    }
  });

  // Get single embedded document by ID
  app.get('/api/embedded-documents/:id', async (req, res) => {
    try {
      const document = await EmbeddedDocument.findById(req.params.id);

      if (!document) {
        return res.status(404).json({
          success: false,
          error: 'Document not found'
        });
      }

      // Increment view count
      document.viewCount += 1;
      await document.save();

      res.json({
        success: true,
        document
      });
    } catch (error) {
      console.error('Error fetching embedded document:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching embedded document'
      });
    }
  });

  // Add new embedded document (admin only)
  app.post('/api/embedded-documents', authenticate, async (req, res) => {
    try {
      let { name, pdfUrl, embedCode, stream, subject, documentType, description, downloadUrl } = req.body;

      if (!name || !stream || !subject) {
        return res.status(400).json({
          success: false,
          error: 'Name, stream, and subject are required'
        });
      }

      if (!pdfUrl && !embedCode) {
        return res.status(400).json({
          success: false,
          error: 'Either PDF URL or embed code is required'
        });
      }

      // Auto-convert Google Drive URLs to optimized format
      if (pdfUrl && pdfUrl.includes('drive.google.com')) {
        const converted = convertDriveUrl(pdfUrl);
        if (converted) {
          pdfUrl = converted.preview; // Use preview URL for embedding
          if (!downloadUrl) {
            downloadUrl = converted.download; // Set download URL
          }
          console.log(`✅ Converted Drive URL: ${pdfUrl}`);
        }
      }

      const newDocument = new EmbeddedDocument({
        name,
        pdfUrl: pdfUrl || '',
        embedCode: embedCode || '',
        stream,
        subject,
        documentType: documentType || 'pdf',
        description: description || '',
        downloadUrl: downloadUrl || '',
        createdBy: req.user._id
      });

      await newDocument.save();

      res.json({
        success: true,
        message: 'Embedded document added successfully',
        document: newDocument
      });
    } catch (error) {
      console.error('Error adding embedded document:', error);
      res.status(500).json({
        success: false,
        error: 'Error adding embedded document'
      });
    }
  });

  // Update embedded document (admin only)
  app.put('/api/embedded-documents/:id', authenticate, async (req, res) => {
    try {
      let { name, pdfUrl, embedCode, stream, subject, documentType, description, downloadUrl, isActive } = req.body;

      // Auto-convert Google Drive URLs to optimized format
      if (pdfUrl && pdfUrl.includes('drive.google.com')) {
        const converted = convertDriveUrl(pdfUrl);
        if (converted) {
          pdfUrl = converted.preview; // Use preview URL for embedding
          if (!downloadUrl) {
            downloadUrl = converted.download; // Set download URL
          }
          console.log(`✅ Converted Drive URL: ${pdfUrl}`);
        }
      }

      const updatedDocument = await EmbeddedDocument.findByIdAndUpdate(
        req.params.id,
        {
          name,
          pdfUrl,
          embedCode,
          stream,
          subject,
          documentType,
          description,
          downloadUrl,
          isActive,
          lastModified: new Date()
        },
        { new: true }
      );

      if (!updatedDocument) {
        return res.status(404).json({
          success: false,
          error: 'Document not found'
        });
      }

      res.json({
        success: true,
        message: 'Embedded document updated successfully',
        document: updatedDocument
      });
    } catch (error) {
      console.error('Error updating embedded document:', error);
      res.status(500).json({
        success: false,
        error: 'Error updating embedded document'
      });
    }
  });

  // Delete embedded document (admin only)
  app.delete('/api/embedded-documents/:id', authenticate, async (req, res) => {
    try {
      const result = await EmbeddedDocument.findByIdAndDelete(req.params.id);

      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'Document not found'
        });
      }

      res.json({
        success: true,
        message: 'Embedded document deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting embedded document:', error);
      res.status(500).json({
        success: false,
        error: 'Error deleting embedded document'
      });
    }
  });

  // ========================================
  // GOOGLE DRIVE API INTEGRATION
  // ========================================

  // Helper: Convert Google Drive URL to direct download/preview URL
  function convertDriveUrl(url) {
    if (!url) return null;

    // Extract file ID from various Google Drive URL formats
    let fileId = null;

    // Format 1: https://drive.google.com/file/d/FILE_ID/view
    const match1 = url.match(/\/file\/d\/([^\/]+)/);
    if (match1) fileId = match1[1];

    // Format 2: https://drive.google.com/open?id=FILE_ID
    const match2 = url.match(/[?&]id=([^&]+)/);
    if (match2) fileId = match2[1];

    // Format 3: Already a file ID
    if (!fileId && url.length > 20 && !url.includes('/') && !url.includes('http')) {
      fileId = url;
    }

    if (!fileId) return null;

    return {
      fileId: fileId,
      preview: `https://drive.google.com/file/d/${fileId}/preview`,
      download: `https://drive.google.com/uc?export=download&id=${fileId}`,
      directApi: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${process.env.GOOGLE_DRIVE_API_KEY || ''}`,
      embed: `https://drive.google.com/file/d/${fileId}/preview`
    };
  }

  // API: Convert Drive URL
  app.post('/api/drive/convert-url', (req, res) => {
    try {
      const { url } = req.body;
      
      if (!url) {
        return res.status(400).json({
          success: false,
          error: 'URL is required'
        });
      }

      const converted = convertDriveUrl(url);
      
      if (!converted) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Google Drive URL'
        });
      }

      res.json({
        success: true,
        ...converted
      });
    } catch (error) {
      console.error('Error converting Drive URL:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // API: Get Drive file metadata (requires API key)
  app.get('/api/drive/file/:fileId', async (req, res) => {
    try {
      const { fileId } = req.params;
      const apiKey = process.env.GOOGLE_DRIVE_API_KEY;

      if (!apiKey) {
        return res.status(500).json({
          success: false,
          error: 'Google Drive API key not configured'
        });
      }

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink&key=${apiKey}`
      );

      if (!response.ok) {
        throw new Error(`Drive API error: ${response.status}`);
      }

      const data = await response.json();

      res.json({
        success: true,
        file: data,
        urls: convertDriveUrl(fileId)
      });
    } catch (error) {
      console.error('Error fetching Drive file:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // API: Proxy Google Drive PDF (handles CORS and authentication)
  app.get('/api/drive/pdf/:fileId', async (req, res) => {
    try {
      const { fileId } = req.params;
      const apiKey = process.env.GOOGLE_DRIVE_API_KEY;

      console.log(`📥 Fetching Drive PDF: ${fileId}`);

      // Try with API key first (most reliable)
      let pdfUrl = apiKey 
        ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`
        : `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;

      const response = await fetch(pdfUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status}`);
      }

      // Get content type
      const contentType = response.headers.get('content-type');
      
      // Check if it's actually a PDF
      if (!contentType || !contentType.includes('pdf')) {
        console.warn(`⚠️ Unexpected content type: ${contentType}`);
      }

      // Stream the PDF
      const buffer = await response.buffer();
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);

      console.log(`✅ Drive PDF sent: ${Math.round(buffer.length / 1024)}KB`);

    } catch (error) {
      console.error('❌ Error fetching Drive PDF:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Serve the main application
  app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Start server
  app.listen(PORT, async () => {
    console.log(`\n🚀 EduSphere Pro Multi-AI Server Started Successfully!`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`🤖 AI Providers: ${aiProviders.length} configured`);

    if (aiProviders.length > 0) {
      console.log(`\n🎯 Active AI Providers (Priority Order):`);
      aiProviders.forEach(provider => {
        console.log(`   ${provider.priority}. ${provider.name} (${provider.model}) - ${provider.speed}`);
      });
    } else {
      console.log(`⚠️  No AI providers configured - running in fallback mode`);
    }

    console.log(`\n📋 Available Endpoints:`);
    console.log(`   🔐 Auth: http://localhost:${PORT}/api/auth/login`);
    console.log(`   🤖 AI Guidance: http://localhost:${PORT}/api/ai-guidance`);
    console.log(`   🔧 AI Status: http://localhost:${PORT}/api/ai-status`);
    console.log(`   🧪 Test Keys: http://localhost:${PORT}/api/test-ai-keys`);

    await initializeDefaultData();
  });
};

// Initialize the server
initializeServer().catch(console.error);

module.exports = app;