from pymongo import MongoClient
from flask import Flask, render_template, request, redirect, url_for, flash, send_file, jsonify, session
from datetime import datetime  # Add this import for formatting timestamps
import os
from werkzeug.utils import secure_filename
import mimetypes
import base64
from PIL import Image
import io
import fitz  # PyMuPDF for PDF preview
import docx2txt  # for Word documents
import hashlib
from gridfs import GridFS

# MongoDB connection
client = MongoClient("mongodb+srv://sujalpatel:6oTVqyaYwRukvBKC@cluster0.ctpna.mongodb.net/?retryWrites=true&w=majority&tlsAllowInvalidCertificates=true")
db = client.get_database('your_database_name')  # Replace 'your_database_name' with the actual database name

# Initialize GridFS
fs = GridFS(db)

# Example collection
collection = db.get_collection('your_collection_name')  # Replace 'your_collection_name' with the actual collection name

# Test the connection
try:
    # Print the list of collections to verify connection
    print("Collections:", db.list_collection_names())
except Exception as e:
    print("Error connecting to MongoDB:", e)

app = Flask(__name__)
app.secret_key = 'your-secret-key-here'  # Change this to a secure secret key

# Configuration
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_file_preview(file_data):
    _, ext = os.path.splitext(file_data.filename)
    ext = ext.lower()
    
    try:
        if ext in ['.jpg', '.jpeg', '.png', '.gif']:
            # Create thumbnail for images
            with Image.open(file_data) as img:
                img.thumbnail((200, 200))
                buffer = io.BytesIO()
                img.save(buffer, format=img.format)
                return f"data:image/{img.format.lower()};base64,{base64.b64encode(buffer.getvalue()).decode()}"
                
        elif ext == '.pdf':
            # Create preview of first page of PDF
            doc = fitz.open(stream=file_data.read(), filetype='pdf')
            if doc.page_count > 0:
                page = doc[0]
                pix = page.get_pixmap(matrix=fitz.Matrix(0.5, 0.5))
                img_data = pix.tobytes("png")
                return f"data:image/png;base64,{base64.b64encode(img_data).decode()}"
            
        elif ext in ['.doc', '.docx']:
            # Get text preview for Word documents
            file_data.seek(0)
            text = docx2txt.process(file_data)
            preview_text = text[:200] + '...' if len(text) > 200 else text
            return preview_text
            
        elif ext in ['.txt']:
            # Text file preview
            file_data.seek(0)  # Reset file pointer
            text = file_data.read(200).decode('utf-8')
            return text + '...' if len(text) > 200 else text
    except Exception as e:
        print(f"Error generating preview: {e}")
    
    return None

def generate_unique_filename(filename, user_email):
    base, extension = os.path.splitext(filename)
    counter = 1
    new_filename = filename
    
    while collection.find_one({'filename': new_filename, 'user_email': user_email}):
        new_filename = f"{base}_{counter}{extension}"
        counter += 1
    
    return new_filename

@app.route('/')
def login():
    if 'user_email' in session:
        return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/login', methods=['POST'])
def do_login():
    email = request.form['email']
    password = request.form['password']
    
    # Retrieve user from MongoDB
    user = db.users.find_one({'email': email})
    
    if user and user['password'] == password:
        session['user_email'] = email
        session['user_name'] = user['name']
        return redirect(url_for('dashboard'))
    else:
        flash('Invalid credentials. Please try again.', 'error')
        return redirect(url_for('login'))

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'user_email' not in session:
        return jsonify({'success': False, 'message': 'Not authorized'}), 401
    
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'message': 'No selected file'}), 400
    
    if file and allowed_file(file.filename):
        original_filename = secure_filename(file.filename)
        filename = generate_unique_filename(original_filename, session['user_email'])
        
        # Store file in MongoDB using GridFS
        file_id = fs.put(file, filename=filename, content_type=file.content_type)
        
        # Calculate file size
        file.seek(0, os.SEEK_END)  # Move to end of file
        file_size = file.tell()  # Get current position (file size)
        file.seek(0)  # Reset file pointer to the beginning
        
        # Generate preview
        preview = get_file_preview(file)
        
        # Store file metadata in MongoDB
        collection.insert_one({
            'user_email': session['user_email'],
            'file_id': file_id,
            'filename': filename,
            'size': file_size,
            'type': filename.split('.')[-1] if '.' in filename else 'unknown',
            'upload_time': datetime.now(),
            'preview': preview
        })
        
        return jsonify({
            'success': True,
            'message': 'File uploaded successfully',
            'file': {
                'name': filename,
                'size': file_size,
                'type': filename.split('.')[-1] if '.' in filename else 'unknown'
            }
        })
    
    return jsonify({'success': False, 'message': 'Invalid file type'}), 400

@app.route('/dashboard')
def dashboard():
    if 'user_email' not in session:
        return redirect(url_for('login'))
    
    files = []
    
    # Retrieve file metadata from MongoDB
    file_metadata = collection.find({'user_email': session['user_email']})
    for metadata in file_metadata:
        files.append({
            'name': metadata['filename'],
            'size': metadata['size'],
            'type': metadata['type'],
            'uploaded_at': metadata['upload_time'].strftime('%Y-%m-%d %H:%M:%S'),
            'preview': metadata.get('preview', '')
        })
    
    # Sort files in descending order of upload time
    files = sorted(files, key=lambda x: x['uploaded_at'], reverse=True)
    
    return render_template('dashboard.html', files=files, user_name=session.get('user_name'))

@app.route('/download/<filename>')
def download_file(filename):
    if 'user_email' not in session:
        return redirect(url_for('login'))
    
    # Retrieve file metadata from MongoDB
    file_metadata = collection.find_one({'user_email': session['user_email'], 'filename': filename})
    if not file_metadata:
        flash('File not found', 'error')
        return redirect(url_for('dashboard'))
    
    # Fetch file from GridFS
    file_id = file_metadata['file_id']
    file_data = fs.get(file_id)
    
    return send_file(file_data, as_attachment=True, download_name=filename, mimetype=file_data.content_type)

@app.route('/view/<filename>')
def view_file(filename):
    if 'user_email' not in session:
        return redirect(url_for('login'))

    # Retrieve file metadata from MongoDB
    file_metadata = collection.find_one({'filename': filename, 'user_email': session['user_email']})
    if not file_metadata:
        return "File not found", 404

    # Retrieve file from GridFS using file_id
    file_data = fs.get(file_metadata['file_id'])

    # Determine the content type and return the file
    content_type = file_data.content_type
    return send_file(file_data, mimetype=content_type, as_attachment=False)

@app.route('/delete/<filename>', methods=['POST'])
def delete_file(filename):
    if 'user_email' not in session:
        return jsonify({'success': False, 'message': 'Not authorized'}), 401
    
    # Retrieve file metadata from MongoDB
    file_metadata = collection.find_one({'user_email': session['user_email'], 'filename': filename})
    if not file_metadata:
        return jsonify({'success': False, 'message': 'File not found'}), 404
    
    # Delete file from GridFS
    file_id = file_metadata['file_id']
    fs.delete(file_id)
    
    # Remove file metadata from MongoDB
    collection.delete_one({'user_email': session['user_email'], 'filename': filename})
    return jsonify({'success': True, 'message': 'File deleted successfully'})

@app.route('/search')
def search():
    if 'user_email' not in session:
        return redirect(url_for('login'))
    
    query = request.args.get('query', '').lower()
    files = []
    
    # Retrieve file metadata from MongoDB
    file_metadata = collection.find({'user_email': session['user_email']})
    for metadata in file_metadata:
        if query in metadata['filename'].lower():
            files.append({
                'name': metadata['filename'],
                'size': metadata['size'],
                'type': metadata['type'],
                'preview': metadata.get('preview', ''),
                'uploaded_time': metadata.get('upload_time', '').strftime('%Y-%m-%d %H:%M:%S')  # Ensure uploaded time is included
            })
    
    return jsonify(files)

@app.route('/logout')
def logout():
    session.pop('user_email', None)
    session.pop('user_name', None)
    return redirect(url_for('login'))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))  # Default to 5000 if PORT is not set
    app.run(host='0.0.0.0', port=port, debug=True)
