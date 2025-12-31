import time
import os
import json, datetime, pytz, sys
import utils.env as env

from PIL import Image, ImageOps

from utils.rabbit_mq import Rabbit_MQ
from utils.tool_msg import ToolMSG
from utils.img_handler import Img_Handler


def _clamp_int(v, lo, hi, default):
    try:
        v = int(v)
        return max(lo, min(hi, v))
    except Exception:
        return default


def _compute_padding(img_w, img_h, params: dict):
    """
    Suporta:
      - percent: número (ex: 25) => expande proporcionalmente em todas as direções
      - left/right/top/bottom: pixels
    Se percent existir, tem prioridade.
    """
    percent = params.get("percent", None)
    if percent is not None:
        p = _clamp_int(percent, 1, 200, 25)  # até 200% (se quiseres)
        pad_x = int((img_w * p) / 100)
        pad_y = int((img_h * p) / 100)
        return pad_x, pad_x, pad_y, pad_y  # left, right, top, bottom

    left = _clamp_int(params.get("left", 0), 0, 4000, 0)
    right = _clamp_int(params.get("right", 0), 0, 4000, 0)
    top = _clamp_int(params.get("top", 0), 0, 4000, 0)
    bottom = _clamp_int(params.get("bottom", 0), 0, 4000, 0)
    return left, right, top, bottom


def _expand_image(img: Image.Image, params: dict) -> Image.Image:
    """
    "Generative Expand" (versão consistente com o stack atual):
      - reflect: espelha bordas (melhor para continuação natural)
      - edge: estica o pixel da borda (mais simples)
      - solid: preenche com cor sólida (params.color "#RRGGBB")
    """
    mode = (params.get("mode") or "reflect").lower()

    left, right, top, bottom = _compute_padding(img.width, img.height, params)
    if left == right == top == bottom == 0:
        return img

    if mode == "solid":
        color = params.get("color", "#000000")
        # Pillow aceita "#RRGGBB"
        return ImageOps.expand(img, border=(left, top, right, bottom), fill=color)

    if mode == "edge":
        # "edge" em Pillow = repete pixels da borda
        return ImageOps.expand(img, border=(left, top, right, bottom)).transform(
            (img.width + left + right, img.height + top + bottom),
            Image.EXTENT,
            (0, 0, img.width + left + right, img.height + top + bottom),
        )

    # default: reflect (espelho)
    # Pillow tem pad reflect no ImageOps.expand? não diretamente, então fazemos via ImageOps.expand + paste manual
    new_w = img.width + left + right
    new_h = img.height + top + bottom
    canvas = Image.new(img.mode, (new_w, new_h))
    canvas.paste(img, (left, top))

    # left strip (mirror)
    if left > 0:
        strip = img.crop((0, 0, min(left, img.width), img.height))
        strip = ImageOps.mirror(strip)
        canvas.paste(strip.resize((left, img.height)), (0, top))

    # right strip
    if right > 0:
        strip = img.crop((max(img.width - right, 0), 0, img.width, img.height))
        strip = ImageOps.mirror(strip)
        canvas.paste(strip.resize((right, img.height)), (left + img.width, top))

    # top strip
    if top > 0:
        strip = canvas.crop((0, top, new_w, top + min(top, img.height)))
        strip = ImageOps.flip(strip)
        canvas.paste(strip.resize((new_w, top)), (0, 0))

    # bottom strip
    if bottom > 0:
        strip = canvas.crop((0, top + img.height - min(bottom, img.height), new_w, top + img.height))
        strip = ImageOps.flip(strip)
        canvas.paste(strip.resize((new_w, bottom)), (0, top + img.height))

    return canvas


class ExpandAiTool:
    def __init__(self):
        self._img_handler = Img_Handler()
        self._tool_msg = ToolMSG(
            "picturas-expand-ai-tool-ms",   # microservice_name (como os outros)
            "expand_ai",                   # tool_name (tem de existir no ToolMSG.queues)
            env.RABBITMQ_HOST,
            int(env.RABBITMQ_PORT),
            env.RABBITMQ_USERNAME,
            env.RABBITMQ_PASSWORD
        )
        self._counter = 0
        self._codes = {
            "wrong_procedure": 2400,
            "error_processing": 2401
        }

    def expand_ai(self, img_path, store_img_path, params):
        img = self._img_handler.get_img(img_path)
        # se quiseres RGBA:
        # img = img.convert("RGBA")
        out = _expand_image(img, params)
        self._img_handler.store_img(out, store_img_path)

    def expand_ai_callback(self, ch, method, properties, body):
        info = json.loads(body.decode())
        msg_id = info["messageId"]
        ts = info["timestamp"]

        # suporta "...Z" e offsets tipo "+00:00"
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"

        timestamp = datetime.datetime.fromisoformat(ts)

        procedure = info["procedure"]
        params = info.get("parameters", {})
        img_path = params["inputImageURI"]
        store_img_path = params["outputImageURI"]

        resp_msg_id = f"expand-ai-{self._counter}-{msg_id}"
        self._counter += 1

        if procedure != "expand_ai":
            cur_timestamp = datetime.datetime.now(pytz.utc)
            processing_time = (cur_timestamp - timestamp).total_seconds() * 1000
            cur_timestamp = cur_timestamp.isoformat()

            self._tool_msg.send_msg(
                msg_id,
                resp_msg_id,
                cur_timestamp,
                "error",
                processing_time,
                None,
                "image",
                self._codes["wrong_procedure"],
                "The procedure received does not fit into this tool",
                img_path
            )
            return

        try:
            # IMPORTANT: passa só os params relevantes à lógica de expand
            # (percent/mode/color/left/right/top/bottom)
            self.expand_ai(img_path, store_img_path, params)

            cur_timestamp = datetime.datetime.now(pytz.utc)
            processing_time = (cur_timestamp - timestamp).total_seconds() * 1000
            cur_timestamp = cur_timestamp.isoformat()

            self._tool_msg.send_msg(
                msg_id,
                resp_msg_id,
                cur_timestamp,
                "success",
                processing_time,
                store_img_path
            )
        except Exception as e:
            cur_timestamp = datetime.datetime.now(pytz.utc)
            processing_time = (cur_timestamp - timestamp).total_seconds() * 1000
            cur_timestamp = cur_timestamp.isoformat()

            self._tool_msg.send_msg(
                msg_id,
                resp_msg_id,
                cur_timestamp,
                "error",
                processing_time,
                None,
                "image",
                self._codes["error_processing"],
                str(e),
                img_path
            )

    def exec(self, args=None):
        while True:
            self._tool_msg.read_msg(self.expand_ai_callback)

if __name__ == "__main__":
    tool = ExpandAiTool()
    tool.exec(sys.argv)