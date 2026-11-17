"""Fluent 3D emoji (Microsoft, MIT licence) for the hook: the picker's list, and the pictures, fetched once from
Microsoft's fluentui-emoji repository (through jsDelivr) and kept in the data folder.

Each emoji is [character, name, path in the repository]."""
import re
import threading
import urllib.request
from pathlib import Path

from . import config

BASE = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/"
GROUPS = [
 [
  "smileys",
  "Smileys",
  [
   [
    "😀",
    "Grinning face",
    "Grinning%20face/3D/grinning_face_3d.png"
   ],
   [
    "😂",
    "Face with tears of joy",
    "Face%20with%20tears%20of%20joy/3D/face_with_tears_of_joy_3d.png"
   ],
   [
    "🤣",
    "Rolling on the floor laughing",
    "Rolling%20on%20the%20floor%20laughing/3D/rolling_on_the_floor_laughing_3d.png"
   ],
   [
    "😊",
    "Smiling face with smiling eyes",
    "Smiling%20face%20with%20smiling%20eyes/3D/smiling_face_with_smiling_eyes_3d.png"
   ],
   [
    "😍",
    "Smiling face with heart-eyes",
    "Smiling%20face%20with%20heart-eyes/3D/smiling_face_with_heart-eyes_3d.png"
   ],
   [
    "🥰",
    "Smiling face with hearts",
    "Smiling%20face%20with%20hearts/3D/smiling_face_with_hearts_3d.png"
   ],
   [
    "😎",
    "Smiling face with sunglasses",
    "Smiling%20face%20with%20sunglasses/3D/smiling_face_with_sunglasses_3d.png"
   ],
   [
    "🤩",
    "Star-struck",
    "Star-struck/3D/star-struck_3d.png"
   ],
   [
    "😭",
    "Loudly crying face",
    "Loudly%20crying%20face/3D/loudly_crying_face_3d.png"
   ],
   [
    "😱",
    "Face screaming in fear",
    "Face%20screaming%20in%20fear/3D/face_screaming_in_fear_3d.png"
   ],
   [
    "🤯",
    "Exploding head",
    "Exploding%20head/3D/exploding_head_3d.png"
   ],
   [
    "🥵",
    "Hot face",
    "Hot%20face/3D/hot_face_3d.png"
   ],
   [
    "🥶",
    "Cold face",
    "Cold%20face/3D/cold_face_3d.png"
   ],
   [
    "😳",
    "Flushed face",
    "Flushed%20face/3D/flushed_face_3d.png"
   ],
   [
    "🤔",
    "Thinking face",
    "Thinking%20face/3D/thinking_face_3d.png"
   ],
   [
    "🙄",
    "Face with rolling eyes",
    "Face%20with%20rolling%20eyes/3D/face_with_rolling_eyes_3d.png"
   ],
   [
    "😏",
    "Smirking face",
    "Smirking%20face/3D/smirking_face_3d.png"
   ],
   [
    "😴",
    "Sleeping face",
    "Sleeping%20face/3D/sleeping_face_3d.png"
   ],
   [
    "🤡",
    "Clown face",
    "Clown%20face/3D/clown_face_3d.png"
   ],
   [
    "💀",
    "Skull",
    "Skull/3D/skull_3d.png"
   ],
   [
    "👀",
    "Eyes",
    "Eyes/3D/eyes_3d.png"
   ],
   [
    "🫡",
    "Saluting face",
    "Saluting%20face/3D/saluting_face_3d.png"
   ],
   [
    "🥹",
    "Face holding back tears",
    "Face%20holding%20back%20tears/3D/face_holding_back_tears_3d.png"
   ],
   [
    "😤",
    "Face with steam from nose",
    "Face%20with%20steam%20from%20nose/3D/face_with_steam_from_nose_3d.png"
   ],
   [
    "🤑",
    "Money-mouth face",
    "Money-mouth%20face/3D/money-mouth_face_3d.png"
   ],
   [
    "😬",
    "Grimacing face",
    "Grimacing%20face/3D/grimacing_face_3d.png"
   ],
   [
    "🙃",
    "Upside-down face",
    "Upside-down%20face/3D/upside-down_face_3d.png"
   ],
   [
    "😮",
    "Face with open mouth",
    "Face%20with%20open%20mouth/3D/face_with_open_mouth_3d.png"
   ],
   [
    "🤐",
    "Zipper-mouth face",
    "Zipper-mouth%20face/3D/zipper-mouth_face_3d.png"
   ],
   [
    "😈",
    "Smiling face with horns",
    "Smiling%20face%20with%20horns/3D/smiling_face_with_horns_3d.png"
   ],
   [
    "🥳",
    "Partying face",
    "Partying%20face/3D/partying_face_3d.png"
   ]
  ]
 ],
 [
  "hands",
  "Hands",
  [
   [
    "👍",
    "Thumbs up",
    "Thumbs%20up/Default/3D/thumbs_up_3d_default.png"
   ],
   [
    "👎",
    "Thumbs down",
    "Thumbs%20down/Default/3D/thumbs_down_3d_default.png"
   ],
   [
    "👏",
    "Clapping hands",
    "Clapping%20hands/Default/3D/clapping_hands_3d_default.png"
   ],
   [
    "🙌",
    "Raising hands",
    "Raising%20hands/Default/3D/raising_hands_3d_default.png"
   ],
   [
    "🙏",
    "Folded hands",
    "Folded%20hands/Default/3D/folded_hands_3d_default.png"
   ],
   [
    "💪",
    "Flexed biceps",
    "Flexed%20biceps/Default/3D/flexed_biceps_3d_default.png"
   ],
   [
    "👉",
    "Backhand index pointing right",
    "Backhand%20index%20pointing%20right/Default/3D/backhand_index_pointing_right_3d_default.png"
   ],
   [
    "👇",
    "Backhand index pointing down",
    "Backhand%20index%20pointing%20down/Default/3D/backhand_index_pointing_down_3d_default.png"
   ],
   [
    "👋",
    "Waving hand",
    "Waving%20hand/Default/3D/waving_hand_3d_default.png"
   ],
   [
    "🤝",
    "Handshake",
    "Handshake/3D/handshake_3d.png"
   ],
   [
    "✌️",
    "Victory hand",
    "Victory%20hand/Default/3D/victory_hand_3d_default.png"
   ],
   [
    "🤞",
    "Crossed fingers",
    "Crossed%20fingers/Default/3D/crossed_fingers_3d_default.png"
   ],
   [
    "🫶",
    "Heart hands",
    "Heart%20hands/Default/3D/heart_hands_3d_default.png"
   ],
   [
    "☝️",
    "Index pointing up",
    "Index%20pointing%20up/Default/3D/index_pointing_up_3d_default.png"
   ],
   [
    "🤙",
    "Call me hand",
    "Call%20me%20hand/Default/3D/call_me_hand_3d_default.png"
   ]
  ]
 ],
 [
  "hearts",
  "Hearts",
  [
   [
    "❤️",
    "Red heart",
    "Red%20heart/3D/red_heart_3d.png"
   ],
   [
    "💔",
    "Broken heart",
    "Broken%20heart/3D/broken_heart_3d.png"
   ],
   [
    "🖤",
    "Black heart",
    "Black%20heart/3D/black_heart_3d.png"
   ],
   [
    "🤍",
    "White heart",
    "White%20heart/3D/white_heart_3d.png"
   ],
   [
    "💙",
    "Blue heart",
    "Blue%20heart/3D/blue_heart_3d.png"
   ],
   [
    "💚",
    "Green heart",
    "Green%20heart/3D/green_heart_3d.png"
   ],
   [
    "💛",
    "Yellow heart",
    "Yellow%20heart/3D/yellow_heart_3d.png"
   ],
   [
    "🧡",
    "Orange heart",
    "Orange%20heart/3D/orange_heart_3d.png"
   ],
   [
    "💜",
    "Purple heart",
    "Purple%20heart/3D/purple_heart_3d.png"
   ],
   [
    "💖",
    "Sparkling heart",
    "Sparkling%20heart/3D/sparkling_heart_3d.png"
   ],
   [
    "💗",
    "Growing heart",
    "Growing%20heart/3D/growing_heart_3d.png"
   ],
   [
    "💕",
    "Two hearts",
    "Two%20hearts/3D/two_hearts_3d.png"
   ],
   [
    "💘",
    "Heart with arrow",
    "Heart%20with%20arrow/3D/heart_with_arrow_3d.png"
   ],
   [
    "❤️‍🔥",
    "Heart on fire",
    "Heart%20on%20fire/3D/heart_on_fire_3d.png"
   ]
  ]
 ],
 [
  "objects",
  "Objects",
  [
   [
    "🔥",
    "Fire",
    "Fire/3D/fire_3d.png"
   ],
   [
    "💯",
    "Hundred points",
    "Hundred%20points/3D/hundred_points_3d.png"
   ],
   [
    "✨",
    "Sparkles",
    "Sparkles/3D/sparkles_3d.png"
   ],
   [
    "⚡",
    "High voltage",
    "High%20voltage/3D/high_voltage_3d.png"
   ],
   [
    "💥",
    "Collision",
    "Collision/3D/collision_3d.png"
   ],
   [
    "🎉",
    "Party popper",
    "Party%20popper/3D/party_popper_3d.png"
   ],
   [
    "🏆",
    "Trophy",
    "Trophy/3D/trophy_3d.png"
   ],
   [
    "💰",
    "Money bag",
    "Money%20bag/3D/money_bag_3d.png"
   ],
   [
    "💸",
    "Money with wings",
    "Money%20with%20wings/3D/money_with_wings_3d.png"
   ],
   [
    "🚀",
    "Rocket",
    "Rocket/3D/rocket_3d.png"
   ],
   [
    "🎮",
    "Video game",
    "Video%20game/3D/video_game_3d.png"
   ],
   [
    "🎯",
    "Bullseye",
    "Bullseye/3D/bullseye_3d.png"
   ],
   [
    "📈",
    "Chart increasing",
    "Chart%20increasing/3D/chart_increasing_3d.png"
   ],
   [
    "👑",
    "Crown",
    "Crown/3D/crown_3d.png"
   ],
   [
    "💎",
    "Gem stone",
    "Gem%20stone/3D/gem_stone_3d.png"
   ],
   [
    "🍿",
    "Popcorn",
    "Popcorn/3D/popcorn_3d.png"
   ],
   [
    "🎬",
    "Clapper board",
    "Clapper%20board/3D/clapper_board_3d.png"
   ],
   [
    "📱",
    "Mobile phone",
    "Mobile%20phone/3D/mobile_phone_3d.png"
   ],
   [
    "💡",
    "Light bulb",
    "Light%20bulb/3D/light_bulb_3d.png"
   ],
   [
    "⏰",
    "Alarm clock",
    "Alarm%20clock/3D/alarm_clock_3d.png"
   ],
   [
    "🧠",
    "Brain",
    "Brain/3D/brain_3d.png"
   ],
   [
    "🚨",
    "Police car light",
    "Police%20car%20light/3D/police_car_light_3d.png"
   ]
  ]
 ],
 [
  "symbols",
  "Symbols",
  [
   [
    "✅",
    "Check mark button",
    "Check%20mark%20button/3D/check_mark_button_3d.png"
   ],
   [
    "❌",
    "Cross mark",
    "Cross%20mark/3D/cross_mark_3d.png"
   ],
   [
    "⚠️",
    "Warning",
    "Warning/3D/warning_3d.png"
   ],
   [
    "❗",
    "Red exclamation mark",
    "Red%20exclamation%20mark/3D/red_exclamation_mark_3d.png"
   ],
   [
    "❓",
    "Red question mark",
    "Red%20question%20mark/3D/red_question_mark_3d.png"
   ],
   [
    "💬",
    "Speech balloon",
    "Speech%20balloon/3D/speech_balloon_3d.png"
   ],
   [
    "🔔",
    "Bell",
    "Bell/3D/bell_3d.png"
   ],
   [
    "⭐",
    "Star",
    "Star/3D/star_3d.png"
   ],
   [
    "🌟",
    "Glowing star",
    "Glowing%20star/3D/glowing_star_3d.png"
   ],
   [
    "🔴",
    "Red circle",
    "Red%20circle/3D/red_circle_3d.png"
   ],
   [
    "➡️",
    "Right arrow",
    "Right%20arrow/3D/right_arrow_3d.png"
   ],
   [
    "🔗",
    "Link",
    "Link/3D/link_3d.png"
   ],
   [
    "📍",
    "Round pushpin",
    "Round%20pushpin/3D/round_pushpin_3d.png"
   ]
  ]
 ]
]
SIZE = 160                                      # kept at this size: sharp for any hook, small on disk


def key(ch: str) -> str:
    """An emoji's file name: its code points in hex, joined by dashes (the variation selector left out)."""
    return "-".join(f"{ord(x):x}" for x in ch if ord(x) != 0xFE0F)


BY_KEY = {key(c): p for _, _, items in GROUPS for c, _, p in items}
_CHARS = sorted((c for _, _, items in GROUPS for c, _, _ in items), key=len, reverse=True)
_FIND = re.compile("|".join(re.escape(c) for c in _CHARS) + "|" + "|".join(re.escape(c.replace("️", "")) for c in _CHARS if "️" in c))
_lock = threading.Lock()


def find(text: str) -> list:
    """[(start, end, key), ...] for every known emoji in the text."""
    return [(m.start(), m.end(), key(m.group())) for m in _FIND.finditer(text or "")]


def picture(k: str):
    """The emoji's picture on this machine, fetched the first time. None if it isn't one of ours or can't be got."""
    p = BY_KEY.get(k)
    if not p:
        return None
    d = config.DATA_DIR / "emoji"
    f = d / f"{k}.png"
    if f.is_file():
        return f
    with _lock:
        if f.is_file():
            return f
        try:
            req = urllib.request.Request(BASE + p, headers={"User-Agent": "SocialShot"})
            data = urllib.request.urlopen(req, timeout=20).read(3_000_000)
            from io import BytesIO

            from PIL import Image
            im = Image.open(BytesIO(data)).convert("RGBA")
            im.thumbnail((SIZE, SIZE), Image.LANCZOS)
            d.mkdir(parents=True, exist_ok=True)
            tmp = f.with_suffix(".part")
            im.save(tmp, "PNG")
            tmp.replace(f)
            return f
        except Exception:  # noqa: BLE001 - no internet: the hook is made without it
            return None
