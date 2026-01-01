from flask import Flask, request, send_file, jsonify
from PIL import Image, ImageOps
import io

app = Flask(__name__)

@app.get("/sdapi/v1/samplers")
def samplers():
    return jsonify([{"name": "mock"}])

@app.post("/outpaint")
def outpaint():
    f_img = request.files["image"]
    f_mask = request.files.get("mask")  # opcional

    img = Image.open(f_img.stream).convert("RGB")

    # Aqui o "mock" só devolve a imagem como veio (já vem com canvas expandido)
    # Se quiser "parecer gerado", pode-se fazer depois algo simples nas margens.
    out = img

    buf = io.BytesIO()
    out.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7860, debug=False)
