#!/bin/bash
# JBoost Analyzer — Deploy Script
# Esegui questo script dalla cartella jboost-analyzer

set -e

echo "🚀 JBoost Analyzer — Deploy"
echo "==========================="

# 1. Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# 2. Init git and push to GitHub
echo ""
echo "📂 Setting up Git..."
git init
git add .
git commit -m "Initial commit: JBoost Analyzer v2 — Next.js + Supabase + Vercel"

echo ""
echo "🔗 Connecting to GitHub..."
git branch -M main
git remote add origin https://github.com/marcocorsaro-sys/jboost-analyzer.git
git push -u origin main

# 3. Deploy to Vercel
echo ""
echo "🌐 Deploying to Vercel..."
echo "If you don't have the Vercel CLI, run: npm i -g vercel"
npx vercel --yes

echo ""
echo "✅ Done! Your project is deployed."
echo ""
echo "⚙️  Next steps:"
echo "   1. Go to https://vercel.com and set environment variables:"
echo "      - NEXT_PUBLIC_SUPABASE_URL"
echo "      - NEXT_PUBLIC_SUPABASE_ANON_KEY"
echo "      - OPENAI_API_KEY"
echo "   2. Go to Supabase Dashboard > Edge Functions > Secrets:"
echo "      - SEMRUSH_API_KEY"
echo "      - AHREFS_API_KEY"
echo "      - GOOGLE_PSI_KEY"
echo "      - SERPAPI_KEY"
echo "   3. Run: npx vercel --prod (for production deploy)"
