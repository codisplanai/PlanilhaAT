import os
import sys

# Garante que a raiz do projeto esteja no sys.path no runtime serverless da Vercel
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
