# -*- coding: utf-8 -*-
"""One-shot SSOT update for sprite expansion taxonomy. Not an image generator."""
from __future__ import annotations

import json
from pathlib import Path

MANIFEST = Path(__file__).resolve().parents[1] / "data" / "sprite_gen_manifest.json"

NEW_OUTFITS = [
    {"id": "season_spring", "label": "春日便装"},
    {"id": "season_summer", "label": "夏日便装"},
    {"id": "season_autumn", "label": "秋日便装"},
    {"id": "season_winter", "label": "冬日便装"},
    {"id": "intimate_lounge", "label": "高亲密居家软私密"},
]

NEW_STATES = [
    {"id": "eating", "label": "用餐互动"},
    {"id": "sleeping", "label": "睡眠/躺卧"},
    {"id": "working_focus", "label": "工作专注姿势"},
]

# id -> (sigs, signature_hooks loc keywords, outfit_hints extras, state_hints)
PACKS: dict[str, dict] = {
    "xiaoyou": {
        "sigs": ["atelier_paint", "floor_sketch", "deadline_lamp"],
        "hooks": {"home": "atelier_paint", "room": "floor_sketch", "cafe": "atelier_paint"},
        "outfit_hints": {
            "atelier_paint": "插画师在画架旁：沾颜料的宽松白衬衫+短裤，手持画笔/调色盘，身体微侧向画布；温柔专注；禁止基图奶油针织套与纯站桩",
            "floor_sketch": "坐在地板上速写：露肩家居T+短裤，速写本摊开在膝上，铅笔在手；柔软内收；禁止站姿与基图针织套",
            "deadline_lamp": "赶稿熬夜：微乱长发、衬衫沾墨点、抱膝或趴桌旁台灯光感道具可省略（纯黑背景只留台灯剪影级小道具）；疲惫温柔；禁止正装",
            "season_spring": "春日便装：浅粉薄开衫+短裙+帆布鞋，可持一小束野花；轻快温柔；禁止厚冬装与基图针织套",
            "season_summer": "夏日便装：短袖露肩上衣+热裤或超短裙+凉鞋，清爽插画师街拍；禁止厚外套与基图针织套",
            "season_autumn": "秋日便装：大地色短风衣+针织背心+短裙+短靴；禁止基图奶油套",
            "season_winter": "冬日便装：宽松毛衣+短裙配过膝袜或长裤+短靴，温暖居家出门感；禁止只罩大衣在基图外套上",
            "intimate_lounge": "高亲密软私密：偏大的男友风白衬衫或薄浴袍+短裤，可抱靠枕，露肩腿，害羞亲昵；禁止露点与情趣内衣",
        },
        "state_hints": {
            "eating": "居家餐桌旁小口吃便利店便当或手作简餐，筷子/叉子在手，身体略前倾；仍是小悠脸发",
            "sleeping": "侧躺或半趴在被褥/懒人沙发上，睡眼朦胧，家居短裤套装；温柔安静",
            "working_focus": "伏案画板前专注描线，舌尖可微抿，衬衫袖卷起；禁止西装",
        },
    },
    "shizuku": {
        "sigs": ["library_ladder", "quiet_reading", "archive_cart"],
        "hooks": {"library": "quiet_reading", "campus": "library_ladder"},
        "outfit_hints": {
            "library_ladder": "图书馆助理：站在矮梯上取书，浅色衬衫+围裙或背心+半裙，一手扶梯一手够书；安静软萌；禁止基图超大针织开衫轮廓",
            "quiet_reading": "捧厚书阅读：坐姿或微靠，浅紫便装，书挡住下半脸亦可；禁止站桩无道具",
            "archive_cart": "推图书推车整理旧书，衬衫+半裙+平底鞋，推车道具可见；禁止基图针织套",
            "season_spring": "春日：淡紫薄开衫+白裙+乐福鞋，文静",
            "season_summer": "夏日：短袖衬衫+膝上裙，清凉图书馆私服",
            "season_autumn": "秋日：灯芯绒背带裙+薄高领",
            "season_winter": "冬日：厚针织+长裙+短靴，仍娇小",
            "intimate_lounge": "软私密：过大衬衫+短袜，抱书或抱枕，害羞；禁止露点",
        },
        "state_hints": {
            "eating": "图书馆休息角安静吃三明治，小口，书放一旁",
            "sleeping": "趴在书桌上打盹或侧躺抱枕，浅紫家居服",
            "working_focus": "低头盖章/录入索书号，专注",
        },
    },
    "wanyu": {
        "sigs": ["barista_steam", "tray_service", "closing_wipe"],
        "hooks": {"cafe": "barista_steam", "store": "tray_service"},
        "outfit_hints": {
            "barista_steam": "咖啡店员拉花：围裙店服，手持拉花杯，蒸汽感小道具，身体前倾专注",
            "tray_service": "托盘送餐：托盘上有两杯咖啡，礼貌微笑站姿微侧",
            "closing_wipe": "打烊擦台：挽袖围裙，抹布在手，略疲惫温柔",
            "season_spring": "春日便装+薄风衣，灰棕发",
            "season_summer": "夏日短袖店外私服+短裙",
            "season_autumn": "秋日米色风衣+围巾",
            "season_winter": "冬日长大衣+围巾+短靴",
            "intimate_lounge": "软私密：宽松衬衫/浴袍，抱枕，咖啡香居家感；禁止露点",
        },
        "state_hints": {
            "eating": "试吃店里甜品/三明治，叉匙在手，围裙可仍穿",
            "sleeping": "打烊后窝在休息椅小睡，围裙解开一半",
            "working_focus": "认真擦蒸汽棒/看订单小票",
        },
    },
    "xingnai": {
        "sigs": ["rooftop_bento", "bike_after_school", "old_photo_album"],
        "hooks": {"campus": "rooftop_bento", "street": "bike_after_school"},
        "outfit_hints": {
            "rooftop_bento": "天台便当：校服或私服，打开便当盒，傲娇别过脸仍递筷子",
            "bike_after_school": "放学推车：校服裙，一手扶自行车车把，书包斜背",
            "old_photo_album": "翻旧相册坐姿，居家或便装，相册摊开，耳尖红",
            "season_spring": "春日水手服或薄开衫校服感",
            "season_summer": "夏日短袖校服/私服",
            "season_autumn": "秋日校服+针织背心",
            "season_winter": "冬日大衣罩校服+围巾",
            "intimate_lounge": "软私密：过大T恤+短裤，抱枕挡脸害羞；禁止露点",
        },
        "state_hints": {
            "eating": "天台或教室吃便当，傲娇咀嚼",
            "sleeping": "趴课桌或居家侧躺，碎发凌乱",
            "working_focus": "写作业皱眉，笔转个不停",
        },
    },
    "fengyin": {
        "sigs": ["gym_stretch", "dorm_controller", "campus_run"],
        "hooks": {"campus": "campus_run", "home": "dorm_controller", "room": "dorm_controller"},
        "outfit_hints": {
            "gym_stretch": "运动拉伸：运动内衣外搭拉链外套+短裤，压腿或伸展，红棕马尾",
            "dorm_controller": "宿舍打游戏：宽松T+短裤，双手握手柄，盘腿坐",
            "campus_run": "跑步装：运动背心+短裤+跑鞋，微喘活力",
            "season_spring": "春日运动外套+短裙",
            "season_summer": "夏日短袖运动风",
            "season_autumn": "秋日卫衣+运动裤",
            "season_winter": "冬日羽绒服+围巾",
            "intimate_lounge": "软私密：大T恤家居，抱手柄或抱枕；禁止露点",
        },
        "state_hints": {
            "eating": "宿舍大口吃饭/吃能量棒，随意",
            "sleeping": "瘫在床上四肢摊开",
            "working_focus": "看网课笔记，腿晃",
        },
    },
    "linxi": {
        "sigs": [
            "desk_papers",
            "print_stack",
            "commute_rail",
            "sticky_notes",
            "pantry_coffee",
            "stamp_route",
            "elevator_rush",
        ],
        "hooks": {
            "office": "desk_papers",
            "street": "commute_rail",
            "cafe": "pantry_coffee",
            "home": "intimate_lounge",
        },
        "outfit_hints": {
            "desk_papers": "工位摊文件：白衬衫卷袖+黑铅笔裙，双手整理/摊开一摞文件于桌面，身体微前倾锐利专注，红丝带仍在；禁止纯站桩与基图泼墨衬衫剪贴板",
            "print_stack": "抱打印件疾走：白衬衫微皱+铅笔裙，双臂抱高摞打印纸/文件夹，迈步感，红挂绳可保留；禁止无道具站桩与基图泼墨套",
            "commute_rail": "地铁通勤：一手扶金属扶手道具，另一手拎通勤包，薄外套或衬衫+裙，略疲仍逞强；禁止纯站桩与基图泼墨剪贴板套",
            "season_spring": "春日：白衬衫+薄西装外套或开衫+膝上裙，通勤清爽；禁止厚冬装与基图泼墨套",
            "season_summer": "夏日：短袖白衬衫+铅笔裙，清爽实习生街拍；禁止厚外套与基图泼墨长袖套",
            "season_autumn": "秋日：风衣或薄大衣+丝巾+半裙，干练秋日通勤；禁止基图泼墨套",
            "season_winter": "冬日：修身大衣+手套+围巾松搭，大衣半敞露出内搭衬衫裙，可抱文件夹；禁止只罩大衣在基图泼墨套上",
            "intimate_lounge": "高亲密软私密：解开一颗扣的男友白衬衫或短浴袍+短裤，红丝带松松系，可抱靠枕，露肩腿，傲娇害羞亲昵；禁止露点与情趣内衣与基图工装",
            "sticky_notes": "隔板贴便利贴：白衬衫卷袖+铅笔裙，一手持马克笔一手贴彩色便利贴到白板/工位隔板，侧身专注标注；禁止纯站桩与基图剪贴板",
            "pantry_coffee": "茶水间按咖啡机：工装衬衫裙，一手按咖啡机按钮一手持纸杯接热饮，蒸汽小道具可见；禁止纯站桩与双屏调试感",
            "stamp_route": "盖审批章：工位或柜台前，一手持印章盖向文件骑缝/审批栏，另一手按住文件摞；红丝带仍在；禁止无道具站桩",
            "elevator_rush": "冲电梯定格：双臂抱文件夹/公文包，迈步冲刺感，衬衫略乱仍逞强，红丝带飞一点；禁止纯站桩与基图泼墨剪贴板",
        },
        "state_hints": {
            "eating": "工位边咬便利店饭团或喝盒装奶茶，另一手仍点触屏幕/文件，傲娇分心；禁止捧碗纯站桩",
            "sleeping": "趴办公桌小睡，手臂垫脸，红丝带散一点，文件堆旁，睡眼朦胧；禁止站姿睡感",
            "working_focus": "敲键盘皱眉，文件高高叠在侧，舌尖可微抿，白衬衫卷袖专注；禁止纯站桩与双屏程序员卫衣感",
        },
    },
    "qingcai": {
        "sigs": ["studio_mirror", "rehearsal_sweat", "stage_bow"],
        "hooks": {"campus": "studio_mirror"},
        "outfit_hints": {
            "studio_mirror": "镜前拉伸：练功服/舞蹈短衫短裤，一手扶镜方向（镜可不画），橙双马尾",
            "rehearsal_sweat": "排练后微汗：毛巾搭肩，运动装，元气笑",
            "stage_bow": "谢幕鞠躬定格：舞台小礼服或练功改演出服，手张开",
            "season_spring": "春日亮色便装+短裙",
            "season_summer": "夏日露肩短上衣+短裙",
            "season_autumn": "秋日卫衣+短裙",
            "season_winter": "冬日毛绒外套+短靴",
            "intimate_lounge": "软私密：宽松家居T+短裤，抱枕；禁止露点",
        },
        "state_hints": {
            "eating": "排练间隙吃能量果冻/便当，坐地上",
            "sleeping": "练功房墙边坐下打盹，毛巾盖脸",
            "working_focus": "跟节拍器对动作，认真",
        },
    },
    "xiaoyang": {
        "sigs": ["club_poster", "lab_coat", "culture_stall"],
        "hooks": {"campus": "club_poster"},
        "outfit_hints": {
            "club_poster": "贴社团海报：校服，双手举海报贴墙感，星星眼",
            "lab_coat": "实验课白大褂罩校服，护目镜可顶头上，烧杯小道具",
            "culture_stall": "文化祭摊位：围裙+校服，递章鱼烧纸盒姿势",
            "season_spring": "春日校服薄款",
            "season_summer": "夏日短袖校服",
            "season_autumn": "秋日校服+针织开衫",
            "season_winter": "冬日校服+大衣",
            "intimate_lounge": "软私密：卡通睡衣短裤，害羞；禁止露点",
        },
        "state_hints": {
            "eating": "教室吃面包，活泼",
            "sleeping": "课桌午睡，腮帮鼓鼓",
            "working_focus": "认真做卷子吐舌",
        },
    },
    "taotao": {
        "sigs": [
            "vocal_booth",
            "choreo_mark",
            "handshake_look",
            "stretch_break",
            "lyric_marker",
            "lightstick_wave",
        ],
        "hooks": {
            "campus": "choreo_mark",
            "cafe": "handshake_look",
            "home": "lyric_marker",
            "street": "lightstick_wave",
        },
        "outfit_hints": {
            "vocal_booth": "录音棚练唱：大耳机罩耳+练习室短装（露脐卫衣或短背心+热裤），一手持歌词板或比心麦克风，身体微侧前倾对麦；粉樱双丸子双马尾；禁止基图华丽舞台荷叶裙全套与纯站桩",
            "choreo_mark": "排舞练功：运动短背心+侧开叉练功短裤/裙+舞蹈鞋，脚旁地面有粉胶带记号小道具，粉樱双马尾甩动感，一手比拍一手伸展；禁止基图舞台装与无记号纯站桩",
            "handshake_look": "握手会定妆：华丽粉白舞台短裙装（可接近但非基图原装），身体微前倾伸手做握手姿势，甜美营业笑；禁止双手空垂纯站桩",
            "season_spring": "春日粉色便装：薄粉开衫+短裙或吊带碎花迷你裙+帆布鞋，可持一小枝桃花/樱花粉袋；元气轻快；禁止厚冬装与基图舞台荷叶裙",
            "season_summer": "夏日街拍：短款露脐上衣或吊带+热裤/超短裙+运动鞋，清爽练习生下班感；禁止厚外套与基图舞台装",
            "season_autumn": "秋日针织：粉橙短针织+百褶短裙+短靴或过膝袜，可围薄围巾；禁止基图舞台装",
            "season_winter": "冬日毛绒：粉白毛绒短外套半敞+内搭短裙或短裤+围巾松搭+短靴，可抱暖手袋；禁止只罩大衣在基图舞台裙上",
            "intimate_lounge": "高亲密软私密：偏大的男友风粉白T或薄浴袍+短裤，卸妆后柔软，可抱靠枕，露肩腿，害羞亲昵；禁止露点与情趣内衣与基图舞台装",
            "stretch_break": "练后拉伸：运动短装坐/跪瑜伽垫上，一手拉腿一手撑地，粉樱马尾微乱，水瓶小道具；禁止排舞记号姿势与基图舞台装与纯站桩",
            "lyric_marker": "划歌词：练习室桌边坐姿，一手持荧光笔画歌词纸，一手按纸，短装便服，专注微抿唇；禁止大耳机录音棚姿势与基图舞台装与纯站桩",
            "lightstick_wave": "应援棒练习：一手举粉应援棒挥手，一手比心或扶腰，便装或轻舞台短裙，元气营业手势；禁止握手会伸手姿势与基图原装全套纯站桩",
        },
        "state_hints": {
            "eating": "练习后坐地板或矮凳吃沙拉盒/饭团，叉子或饭团在手，运动短装微汗，毛巾搭肩；禁止捧碗站桩",
            "sleeping": "休息室沙发蜷睡或侧躺，宽松家居T+短裤，粉樱发散乱，睡眼朦胧；禁止站姿睡感",
            "working_focus": "对镜练表情/口型，一手扶镜框方向（镜可不画）一手比口型，练功短装，认真专注；禁止西装与纯站桩",
        },
    },
    "qiansha": {
        "sigs": [
            "dual_monitor",
            "debug_mug",
            "hoodie_focus",
            "pr_review",
            "figma_compare",
            "deploy_watch",
        ],
        "hooks": {
            "office": "dual_monitor",
            "home": "hoodie_focus",
            "room": "debug_mug",
            "cafe": "pr_review",
            "store": "figma_compare",
            "street": "deploy_watch",
        },
        "outfit_hints": {
            "dual_monitor": "双屏敲代码：黑衬衫或薄卫衣+短裤/短裙，坐姿侧对双显示器光，双手敲键盘，极长淡紫发，厌世偷瞄；禁止基图超大卫衣斜挎包套与纯站桩",
            "debug_mug": "咖啡续命：抱印 logo 马克杯盯屏幕，大耳机挂颈，薄黑卫衣或衬衫+短裤，微前倾；禁止双手空垂站桩与基图斜挎包全套",
            "hoodie_focus": "耳机卫衣专注：黑紫帽衫抽绳松搭、耳机罩耳或挂颈，一手插兜一手持手机/触控笔，站或半坐锐利眼神；禁止双屏坐姿与基图斜挎笔记本套纯站桩",
            "season_spring": "春日便装：薄黑紫卫衣半敞+牛仔裤或短裙+帆布鞋，可持咖啡外带杯；轻快前端下班感；禁止厚冬装与基图超大卫衣斜挎套",
            "season_summer": "夏日街拍：短袖黑T或露脐短卫衣+短裤/超短裙+运动鞋，耳机挂颈；禁止厚外套与基图长卫衣全套",
            "season_autumn": "秋日便装：短皮衣或薄夹克罩短卫衣+短裙/牛仔裤+短靴，利落秋感；禁止基图超大卫衣斜挎套",
            "season_winter": "冬日厚装：厚黑紫卫衣+围巾松搭+短裙或短裤外露+短靴，可抱暖手宝或马克杯；禁止只罩大衣在基图原卫衣斜挎上",
            "intimate_lounge": "高亲密软私密：过大男友风黑卫衣只到大腿+短裤，抱枕，卸妆后别扭害羞亲昵，露肩腿；禁止露点与情趣内衣与基图斜挎套",
            "pr_review": "审 PR：短袖黑衬衫或薄工装T+短裤，坐/站矮桌边，笔记本或平板展开 diff，手指点滚动条或批注；极长淡紫发；禁止双屏敲键盘姿势与基图超大卫衣斜挎与纯站桩",
            "figma_compare": "对照设计稿：一手持平板/手机显示 UI mock，一手指显示器方向（屏可道具级），黑衬衫微敞+短裙，设计师对接感；禁止审 PR 点 diff 姿势与基图卫衣斜挎与纯站桩",
            "deploy_watch": "盯发布：抱臂或双手插兜，大耳机挂颈，目光盯状态灯/日志小面板道具，薄卫衣或衬衫+短裤，紧张等待；禁止敲代码坐姿与基图斜挎全套纯站桩",
        },
        "state_hints": {
            "eating": "工位边吃泡面，叉子挑面，笔记本屏幕亮着推到一边，薄黑卫衣或衬衫；禁止捧碗站桩",
            "sleeping": "键盘前趴睡或电竞椅/沙发裹毯侧躺，过大家居卫衣+短裤，淡紫发散乱，睡眼朦胧；禁止站姿睡感",
            "working_focus": "debug 皱眉，一手指屏幕/触控板一手扶耳机，短袖工装T或衬衫，专注锐利；禁止西装与纯站桩",
        },
    },
    "yeyu": {
        "sigs": [
            "mannequin_pin",
            "fabric_drape",
            "look_sketch",
            "pattern_cut",
            "tape_measure",
            "iron_hem",
        ],
        "hooks": {"home": "mannequin_pin", "store": "fabric_drape", "cafe": "look_sketch"},
        "outfit_hints": {
            "mannequin_pin": "人台别针：微敞黑衬衫或短马甲+高腰迷你裙/工装短裤，嘴叼银别针，一手扶人台布料一手别针定型，身体微侧前倾专注；电光蓝挑染短发；禁止基图高领长风衣与纯站桩",
            "fabric_drape": "披挂布料打版：肩上/臂上搭深蓝或暗银色布卷，一手拎布一手比量腰线，微敞黑衬衫+短裤，利落短发；禁止无布料站桩与基图长风衣高领",
            "look_sketch": "看稿改look：一手持速写本或平板摊开设计稿，一手轻托下巴或指点画面，黑衬衫微敞+迷你裙，侧身站姿；禁止空着手站桩与基图长风衣",
            "season_spring": "春日便装：薄黑衬衫半敞+短风衣敞开+迷你裙或热裤+短靴，可持一小卷布样；冷感轻快；禁止厚冬装与基图高领长风衣",
            "season_summer": "夏日便装：黑短袖露脐针织或深V短上衣+热裤/超短裙+厚底凉鞋，清爽设计师街拍；禁止厚外套与基图长风衣",
            "season_autumn": "秋日便装：短款黑皮夹克+内搭深V针织+迷你裙+短靴，利落秋感；禁止基图长风衣高领套",
            "season_winter": "冬日便装：修身黑大衣半敞露出内搭短裙或短裤+围巾松搭+短靴，可抱一小叠布料样本；禁止只罩大衣在基图高领长风衣上",
            "intimate_lounge": "高亲密软私密：偏大的男友风黑衬衫或薄浴袍+短裤，可抱靠枕或布料卷，露肩腿，少言害羞亲昵；禁止露点与情趣内衣与基图长风衣",
            "pattern_cut": "裁剪台剪布：围裙或卷袖黑衬衫+短裤，坐/站矮裁剪台前，一手持裁布剪刀一手压纸样，散落布片小道具；禁止纯站桩与基图长风衣",
            "tape_measure": "量体卷尺：微敞黑衬衫+迷你裙，双手持软尺围在人台或自己腰际比量，侧身专注；禁止无卷尺站桩与基图高领长风衣",
            "iron_hem": "熨烫锁边：卷袖工装衬衫+短裤，一手持迷你熨斗/锁边机感小道具一手抚布边，微前倾；禁止纯站桩与基图长风衣",
        },
        "state_hints": {
            "eating": "打版工作台边随便吃便利店寿司盒，筷子或叉在手，纸样/布料推到一边，微敞黑衬衫工装；禁止捧碗站桩",
            "sleeping": "布料堆或懒人沙发旁坐下/侧躺打盹，短吊带或宽松家居T+短裤，碎发布料盖腿，睡眼朦胧；禁止站姿睡感",
            "working_focus": "低头打版画线，舌尖可微抿，笔或划粉在手，卷袖黑衬衫，专注冷感；禁止西装与纯站桩",
        },
    },
    "aili": {
        "sigs": [
            "bouquet_wrap",
            "greenhouse_mist",
            "ribbon_cut",
            "stem_trim",
            "vase_arrange",
            "delivery_box",
            "window_display",
        ],
        "hooks": {
            "store": "bouquet_wrap",
            "park": "greenhouse_mist",
            "cafe": "ribbon_cut",
            "home": "vase_arrange",
            "street": "delivery_box",
        },
        "outfit_hints": {
            "bouquet_wrap": "柜台包花：深绿围裙+卷袖衬衫+半裙，双手绕牛皮纸/玻璃纸与花束打结，身体微前倾专注；蜜金波浪发；禁止基图捧成束站桩绣花礼服与纯站姿",
            "greenhouse_mist": "温室浇水：卷袖亚麻衬衫+工装围裙+半裙，一手持喷壶喷向叶片，水雾小道具可见；禁止基图绣花长裙与纯站桩",
            "ribbon_cut": "剪缎带收尾：围裙工装，一手持花剪一手拉丝带，精致半侧身；禁止无道具站桩与基图绣花礼服",
            "season_spring": "春日：碎花薄裙+薄开衫或小围裙，可持一小束野花；轻快温柔；禁止厚冬装与基图绣花礼服",
            "season_summer": "夏日：亚麻短袖衬衫+短裙+凉鞋，清爽花艺师街拍；禁止厚外套与基图绣花长裙",
            "season_autumn": "秋日：大地色针织+长裙或半裙+短靴，可围薄丝巾；禁止基图绣花礼服",
            "season_winter": "冬日：修身大衣+手套+围巾松搭，大衣半敞露出内搭裙，可抱一小盆绿植；禁止只罩大衣在基图绣花裙上",
            "intimate_lounge": "高亲密软私密：丝质短睡袍或男友衬衫+吊带短裤，蜜金波浪披散，可抱靠枕或干花束，露肩腿，害羞亲昵；禁止露点与情趣内衣与基图绣花礼服",
            "stem_trim": "工作台修枝：围裙工装，坐或站在矮台前，花剪修剪花茎，散落叶片小道具；禁止纯站桩与基图绣花礼服",
            "vase_arrange": "插瓶：双手把花枝插入玻璃花瓶，围裙或便装，侧身专注；禁止捧成束站桩礼服",
            "delivery_box": "送花出门：双手托/抱纸箱或花盒，围裙可解一半+便装大衣，迈步感；禁止基图绣花礼服捧花站桩",
            "window_display": "橱窗摆设：踮脚或微蹲调整橱窗花艺，围裙工装，一手扶架一手摆花；禁止纯站桩",
        },
        "state_hints": {
            "eating": "花店后厨或小桌旁吃轻食/喝汤，勺子或叉子在手，围裙可仍穿，花瓣香气感；禁止捧碗站桩",
            "sleeping": "沙发或床侧躺，蜜金波浪披散，丝质吊带睡裙或短袍，睡眼朦胧；禁止站姿睡感",
            "working_focus": "低头修枝或缠花茎胶带，舌尖可微抿，围裙工装，专注；禁止西装与纯站桩",
        },
    },
    "jingliu": {
        "sigs": [
            "boardroom_stand",
            "lookbook_flip",
            "event_glass",
            "client_pitch",
            "sample_swatch",
            "phone_brief",
            "moodboard_pin",
            "fitting_mirror",
            "press_kit",
            "logo_redline",
            "runway_front",
            "vendor_card",
            "taxi_brief",
            "rooftop_night",
            "contract_stamp",
            "sample_unbox",
            "menu_pairing",
            "lipstick_touch",
            "shared_lookbook",
        ],
        "hooks": {
            "office": "boardroom_stand",
            "cafe": "lookbook_flip",
            "street": "event_glass",
            "store": "vendor_card",
            "home": "rooftop_night",
        },
        "outfit_hints": {
            "boardroom_stand": "会议室站姿：黑金职业装或旗袍改良通勤，手持文件夹，成熟气场",
            "lookbook_flip": "翻 lookbook：杂志/画册摊开，优雅坐或靠桌",
            "event_glass": "品牌晚宴：精致礼服，高脚杯在手（无酒精强调也可是香槟杯造型）",
            "client_pitch": "客户提案：黑金剪裁裙装，手持提案夹或平板，站姿讲解手势",
            "sample_swatch": "看色卡面料：靠桌翻色卡/布样册，优雅顾问",
            "phone_brief": "电话简报：一手持手机贴耳，一手夹文件夹，通勤高跟",
            "season_spring": "春日西装裙",
            "season_summer": "夏日丝质衬衫+窄裙",
            "season_autumn": "秋日风衣+丝巾",
            "season_winter": "冬日大衣+金饰",
            "intimate_lounge": "软私密：丝质睡袍，金饰卸下大半，成熟亲昵；禁止露点",
            "moodboard_pin": "钉品牌 moodboard：黑金剪裁裙装+高跟，面对便签/杂志撕页墙，一手图钉一手样品照，侧身钉板；禁止基图旗袍站桩与纯站姿",
            "fitting_mirror": "样衣对镜：职场半卸或丝质衬衫+窄裙，一手持衣架样衣对照身形，侧身微调领口/腰带；禁止基图旗袍站桩与会议室持夹",
            "press_kit": "整理媒体夹：黑金通勤裙装，双手整理新闻稿文件夹与名片叠，身体微倾桌面；禁止持高脚杯与纯站桩",
            "logo_redline": "红笔圈改 logo 稿：靠桌摊开品牌稿纸，红笔批注，衬衫袖挽起或半敞西装；禁止只翻色卡与基图旗袍站桩",
            "runway_front": "秀场前排：礼服通勤剪裁黑金裙+高跟，双手翻节目单/座次卡，身体微前倾观秀感；禁止持香槟杯站桩",
            "vendor_card": "供应商递名片：展台侧，黑金职业裙，双手递/接名片与小色卡样，侧身礼貌；禁止会议室持夹与纯站桩",
            "taxi_brief": "车内赶场简报：坐姿，耳机或手机贴耳，文件夹在膝，通勤高跟可见；纯黑底只留座椅剪影级道具；禁止站姿持夹",
            "rooftop_night": "天台夜谈：风衣半敞+丝裙高跟，靠栏杆看城市天际线道具级，一手轻扶栏；港风成熟；禁止基图旗袍站桩",
            "contract_stamp": "签合同盖章：桌前黑金职业装，一手持笔或印章一手按合同摊开；禁止纯站姿与看色卡",
            "sample_unbox": "拆品牌样品盒：职场裙装，双手打开礼盒露出丝巾/小样，惊喜专业；禁止持香槟与基图旗袍站桩",
            "menu_pairing": "晚宴酒单校对：晚宴裙装（可短披肩），双手持菜单/酒单轻点条目；与 event_glass 持杯区分，禁止高脚杯在手",
            "lipstick_touch": "出门前补妆：港风通勤或半卸正装，金粉盒/口红在手，对镜级补妆仪式；成熟优雅；禁止基图旗袍站桩",
            "shared_lookbook": "并坐共翻 lookbook：便装或职场半卸，画册摊开朝向观众侧，身体微倾像并坐；害羞亲昵；禁止会议室持夹站桩",
        },
        "state_hints": {
            "eating": "商务简餐，坐姿优雅",
            "sleeping": "酒店式大床侧躺，睡袍",
            "working_focus": "批注方案，眼镜可有",
        },
    },
    "ruolin": {
        "sigs": [
            "lecture_pointer",
            "office_hours",
            "chalk_sleeve",
            "evening_tea",
            "podium_lean",
            "grading_sofa",
            "campus_twilight",
        ],
        "hooks": {
            "campus": "lecture_pointer",
            "office": "office_hours",
            "library": "office_hours",
            "home": "evening_tea",
            "cafe": "evening_tea",
        },
        "outfit_hints": {
            "lecture_pointer": "讲台授课：深栗盘发，半敞奶油西装外套+丝质深V衬衫+高腰包臀半裙+黑丝细高跟，右手持教鞭/激光笔指向前方，身体微侧站讲台边；知性性感；禁止基图扣紧铅笔裙套与捧哲学书站桩",
            "office_hours": "答疑办公：坐办公桌后侧身，丝质衬衫少扣+半敞西装，膝上或桌上摊开学生论文与茶杯，一手持红笔或轻托腮；成熟温柔；禁止纯站姿与基图捧书套",
            "chalk_sleeve": "黑板讲解：挽起西装袖口露出粉笔灰，一手持粉笔/黑板擦，一手轻点板面，盘发略松，衬衫微敞；禁止干净无灰袖与纯站桩",
            "season_spring": "春日便装：浅驼薄西装外套敞开+丝质吊带或少扣衬衫+膝上包臀裙+细高跟，可持一小束春花；知性轻快；禁止厚冬装与基图 office 套",
            "season_summer": "夏日便装：薄丝质短袖深V衬衫或吊带+超高腰迷你半裙+凉鞋/细高跟，清爽性感讲师街拍；禁止厚外套与基图铅笔裙套",
            "season_autumn": "秋日便装：大地色短风衣半敞+贴身针织+膝上裙+短靴，曲线仍可读；禁止基图 office 套",
            "season_winter": "冬日便装：修身长大衣半敞露出丝质衬衫与包臀裙+围巾松松搭肩+过膝袜或黑丝+短靴，成熟冬日街拍；禁止只罩大衣在基图外套上",
            "intimate_lounge": "高亲密软私密：解开盘发披肩深栗长发，偏大男友风白衬衫或薄丝绸短浴袍+短裤，可抱靠枕，露肩腿锁骨，害羞亲昵；成熟讲师卸下职业壳；禁止露点与情趣内衣",
            "evening_tea": "居家晚茶：披肩长发或半散盘发，丝质吊带+短家居袍，双手捧茶杯，身体微侧慵懒坐或站；知性性感；禁止外出西装与哲学书",
            "podium_lean": "讲台侧靠：身体侧倚讲台边，深V丝质衬衫+半敞西装+包臀半裙+黑丝高跟，教鞭闲置一旁或轻搭台面，曲线可见；禁止捧书站桩",
            "grading_sofa": "沙发改卷：半卸正装或丝质家居衫，交叠腿坐沙发，红笔在手、论文堆在膝旁，盘发略松；禁止纯站姿与基图 office 套",
            "campus_twilight": "课后校园：开襟长大衣或半敞西装外套+修身便装+高跟，一手持文件夹/讲义，身体微前倾迈步感；暮色出门；禁止基图捧哲学书站桩",
        },
        "state_hints": {
            "eating": "办公室或居家桌旁优雅吃便当/简餐，筷子或叉子在手，丝质衬衫家居或半敞西装，茶杯在旁；禁止捧碗站桩",
            "sleeping": "居家侧躺或半趴沙发/床，丝质吊带睡裙或短袍，深栗长发披散，睡眼朦胧；可外套搭肩；禁止办公桌趴睡站姿感",
            "working_focus": "伏案用红笔圈改学生论文，舌尖可微抿，袖口挽起，衬衫微敞，专注成熟；禁止西装扣紧站桩",
        },
    },
    "miara": {
        "sigs": ["merch_counter", "wig_adjust", "sewing_cos"],
        "hooks": {"store": "merch_counter", "cafe": "wig_adjust", "home": "sewing_cos"},
        "outfit_hints": {
            "merch_counter": "谷子店柜台：店员围裙+便装，柜台摆谷子盒，薄荷绿长发，尖耳道具可留",
            "wig_adjust": "整理假发/耳饰：便装，双手抬向耳侧，非精灵礼服",
            "sewing_cos": "缝 cos 服：坐姿，布料与针线，家居或便装，去掉层叠纱裙",
            "season_spring": "春日彩色便装",
            "season_summer": "夏日短袖+短裙",
            "season_autumn": "秋日针织+半裙",
            "season_winter": "冬日大衣+围巾",
            "intimate_lounge": "软私密：宽松家居T，耳尖红，抱谷子抱枕；禁止露点与精灵礼服",
        },
        "state_hints": {
            "eating": "店后吃便利店饭团",
            "sleeping": "布料堆旁打盹",
            "working_focus": "贴价签/盘点手办",
        },
    },
    "shiori": {
        "sigs": ["shelf_ladder", "recommend_stack", "window_read"],
        "hooks": {"store": "shelf_ladder", "library": "window_read", "cafe": "recommend_stack"},
        "outfit_hints": {
            "shelf_ladder": "书店梯：浅色衬衫+围裙，梯上取书，深紫长发，无鲁特琴",
            "recommend_stack": "推荐书堆：双手捧书堆递出，店员装",
            "window_read": "窗边读书：便装，书翻开，雨光感可省略，安静",
            "season_spring": "春日针织+长裙",
            "season_summer": "夏日衬衫+半裙",
            "season_autumn": "秋日风衣",
            "season_winter": "冬日大衣+围巾",
            "intimate_lounge": "软私密：宽松衬衫家居，抱书，文静害羞；禁止游吟 cos 与琴",
        },
        "state_hints": {
            "eating": "店内角落吃面包配茶",
            "sleeping": "阅读椅上睡着，书盖腹",
            "working_focus": "贴书架分类标签",
        },
    },
    "luna": {
        "sigs": ["latte_moon", "break_tarot", "astro_apron"],
        "hooks": {"cafe": "latte_moon", "home": "break_tarot", "store": "astro_apron"},
        "outfit_hints": {
            "latte_moon": "月亮拉花：咖啡围裙店服，展示杯面月牙拉花，午夜蓝长发，无尖帽披风",
            "break_tarot": "休息占卜：便装，塔罗牌摊桌，神秘轻快，无魔女 cos 全套",
            "astro_apron": "星空小徽章围裙特写工装：店员装+月牙徽章，干练",
            "season_spring": "春日薄外套便装",
            "season_summer": "夏日短袖店外私服",
            "season_autumn": "秋日针织",
            "season_winter": "冬日大衣",
            "intimate_lounge": "软私密：宽松星空图案家居T或衬衫，害羞；禁止尖帽披风露点",
        },
        "state_hints": {
            "eating": "试喝新品拿铁，杯沿有奶沫",
            "sleeping": "休息室蜷睡，围裙叠旁",
            "working_focus": "认真擦杯子/看班表",
        },
    },
}

SHARED_SEASON_IDS = [
    "season_spring",
    "season_summer",
    "season_autumn",
    "season_winter",
    "intimate_lounge",
]


def main() -> None:
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    existing_ids = {o["id"] for o in m["outfits"]}
    for o in NEW_OUTFITS:
        if o["id"] not in existing_ids:
            m["outfits"].append(o)
    existing_states = {s["id"] for s in m["states"]}
    for s in NEW_STATES:
        if s["id"] not in existing_states:
            m["states"].append(s)

    for cid, pack in PACKS.items():
        ch = m["characters"].get(cid)
        if not ch:
            print("missing", cid)
            continue
        ch["signature_plan"] = list(pack["sigs"])
        ch["signature_hooks"] = dict(pack["hooks"])
        plan = list(ch.get("outfit_plan") or [])
        for oid in SHARED_SEASON_IDS + pack["sigs"]:
            if oid not in plan:
                plan.append(oid)
        ch["outfit_plan"] = plan
        sp = list(ch.get("state_plan") or [])
        for sid in ("eating", "sleeping", "working_focus"):
            if sid not in sp:
                sp.append(sid)
        ch["state_plan"] = sp
        hints = dict(ch.get("outfit_hints") or {})
        hints.update(pack["outfit_hints"])
        ch["outfit_hints"] = hints
        ch["state_hints"] = dict(pack["state_hints"])

    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("updated", MANIFEST, "chars", len(PACKS))


if __name__ == "__main__":
    main()
