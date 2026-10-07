/* 自动生成（scripts/build-demo.mjs）：演示同学（全部虚构，来自 server/seed.js）、问卷题目、隐私说明版本。不要手改。 */
window.YL_DEMO_DATA = {
 "consentVersion": "2026-10",
 "questions": [
  {
   "id": "goals",
   "type": "multi",
   "required": true,
   "public": true,
   "label": {
    "zh": "这次想聊什么（可多选）",
    "en": "What would you like to chat about? (pick any)"
   },
   "options": [
    {
     "id": "academic",
     "label": {
      "zh": "学界求职",
      "en": "Academic careers"
     }
    },
    {
     "id": "industry",
     "label": {
      "zh": "业界求职",
      "en": "Industry careers"
     }
    },
    {
     "id": "friends",
     "label": {
      "zh": "交朋友",
      "en": "Making friends"
     }
    },
    {
     "id": "share",
     "label": {
      "zh": "分享经验、带学弟学妹",
      "en": "Sharing experience with juniors"
     }
    }
   ],
   "overlapWeight": 1,
   "overlapCap": 1,
   "complements": [
    [
     "industry",
     "share"
    ],
    [
     "academic",
     "share"
    ]
   ],
   "complementWeight": 3,
   "reasons": {
    "overlap": {
     "zh": "你们都想{items}",
     "en": "You both want: {items}"
    },
    "complement": {
     "zh": "一方想聊{items}，另一方愿意分享经验",
     "en": "One of you wants {items}; the other is happy to share"
    }
   }
  },
  {
   "id": "interests",
   "type": "tags",
   "required": true,
   "public": true,
   "max": 5,
   "allowCustom": true,
   "label": {
    "zh": "兴趣爱好（选 1–5 个，也可以自己加）",
    "en": "Interests (pick 1–5, or add your own)"
   },
   "options": [
    {
     "id": "hiking",
     "label": {
      "zh": "徒步",
      "en": "Hiking"
     }
    },
    {
     "id": "running",
     "label": {
      "zh": "跑步",
      "en": "Running"
     }
    },
    {
     "id": "ball",
     "label": {
      "zh": "球类运动",
      "en": "Ball sports"
     }
    },
    {
     "id": "fitness",
     "label": {
      "zh": "健身",
      "en": "Fitness"
     }
    },
    {
     "id": "food",
     "label": {
      "zh": "美食探店",
      "en": "Food"
     }
    },
    {
     "id": "cooking",
     "label": {
      "zh": "做饭",
      "en": "Cooking"
     }
    },
    {
     "id": "coffee",
     "label": {
      "zh": "咖啡",
      "en": "Coffee"
     }
    },
    {
     "id": "travel",
     "label": {
      "zh": "旅行",
      "en": "Travel"
     }
    },
    {
     "id": "photo",
     "label": {
      "zh": "摄影",
      "en": "Photography"
     }
    },
    {
     "id": "music",
     "label": {
      "zh": "音乐",
      "en": "Music"
     }
    },
    {
     "id": "art",
     "label": {
      "zh": "看展、艺术",
      "en": "Art"
     }
    },
    {
     "id": "film",
     "label": {
      "zh": "电影剧集",
      "en": "Film & TV"
     }
    },
    {
     "id": "reading",
     "label": {
      "zh": "读书",
      "en": "Reading"
     }
    },
    {
     "id": "boardgames",
     "label": {
      "zh": "桌游",
      "en": "Board games"
     }
    },
    {
     "id": "gaming",
     "label": {
      "zh": "游戏",
      "en": "Gaming"
     }
    },
    {
     "id": "tech",
     "label": {
      "zh": "科技、AI",
      "en": "Tech & AI"
     }
    },
    {
     "id": "investing",
     "label": {
      "zh": "投资理财",
      "en": "Investing"
     }
    },
    {
     "id": "podcasts",
     "label": {
      "zh": "播客",
      "en": "Podcasts"
     }
    }
   ],
   "overlapWeight": 2,
   "overlapCap": 3,
   "reasons": {
    "overlap": {
     "zh": "你们都喜欢{items}",
     "en": "You both like {items}"
    }
   }
  },
  {
   "id": "field",
   "type": "single",
   "required": true,
   "public": true,
   "label": {
    "zh": "你在 / 想去的领域",
    "en": "Your field (current or target)"
   },
   "options": [
    {
     "id": "finance",
     "label": {
      "zh": "金融",
      "en": "Finance"
     }
    },
    {
     "id": "consulting",
     "label": {
      "zh": "咨询",
      "en": "Consulting"
     }
    },
    {
     "id": "tech",
     "label": {
      "zh": "科技互联网",
      "en": "Tech"
     }
    },
    {
     "id": "data",
     "label": {
      "zh": "数据与量化",
      "en": "Data & quant"
     }
    },
    {
     "id": "biotech",
     "label": {
      "zh": "医药生物",
      "en": "Biotech & health"
     }
    },
    {
     "id": "academia",
     "label": {
      "zh": "学术科研",
      "en": "Academia"
     }
    },
    {
     "id": "law",
     "label": {
      "zh": "法律",
      "en": "Law"
     }
    },
    {
     "id": "public",
     "label": {
      "zh": "公共政策与非营利",
      "en": "Policy & nonprofit"
     }
    },
    {
     "id": "arts",
     "label": {
      "zh": "文化艺术与传媒",
      "en": "Arts & media"
     }
    },
    {
     "id": "startup",
     "label": {
      "zh": "创业",
      "en": "Startups"
     }
    },
    {
     "id": "other",
     "label": {
      "zh": "其他 / 还没想好",
      "en": "Other / undecided"
     }
    }
   ],
   "overlapWeight": 2,
   "overlapCap": 1,
   "ignoreForOverlap": [
    "other"
   ],
   "reasons": {
    "overlap": {
     "zh": "你们都在{items}领域",
     "en": "You're both in {items}"
    }
   }
  },
  {
   "id": "intro",
   "type": "text",
   "required": false,
   "public": true,
   "max": 200,
   "label": {
    "zh": "一句话介绍自己（可选）",
    "en": "One line about you (optional)"
   },
   "placeholder": {
    "zh": "比如：SOM 二年级，想转科技行业，周末爱爬山。别写联系方式和全名",
    "en": "e.g. 2nd-year SOM, moving into tech, hikes on weekends. No contact details or full names, please"
   }
  }
 ],
 "users": [
  {
   "id": "u-demo01",
   "login_email": "demo01@demo.yale.edu",
   "contact_email": "demo1@example.com",
   "name": "陈思远",
   "identity": "student",
   "stage": "master",
   "grad_year": 2027,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-1（示例）",
   "answers": {
    "goals": [
     "academic",
     "industry"
    ],
    "interests": [
     "coffee",
     "boardgames",
     "gaming",
     "hiking"
    ],
    "field": "biotech",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo02",
   "login_email": "demo02@demo.yale.edu",
   "contact_email": "demo2@example.com",
   "name": "林可欣",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "Data Scientist",
   "city": "New Haven",
   "contact_method": "微信 demo-2（示例）",
   "answers": {
    "goals": [
     "share"
    ],
    "interests": [
     "gaming",
     "fitness",
     "podcasts",
     "ball"
    ],
    "field": "biotech",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo03",
   "login_email": "demo03@demo.yale.edu",
   "contact_email": "demo3@example.com",
   "name": "王子涵",
   "identity": "student",
   "stage": "master",
   "grad_year": 2029,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-3（示例）",
   "answers": {
    "goals": [
     "industry"
    ],
    "interests": [
     "food",
     "photo",
     "cooking",
     "fitness"
    ],
    "field": "other",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo04",
   "login_email": "demo04@demo.yale.edu",
   "contact_email": "demo4@example.com",
   "name": "赵一鸣",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "Software Engineer @ 某科技公司",
   "city": "Beijing",
   "contact_method": "微信 demo-4（示例）",
   "answers": {
    "goals": [
     "share",
     "friends"
    ],
    "interests": [
     "ball",
     "running",
     "cooking"
    ],
    "field": "biotech",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo05",
   "login_email": "demo05@demo.yale.edu",
   "contact_email": "demo5@example.com",
   "name": "孙悦然",
   "identity": "student",
   "stage": "master",
   "grad_year": 2028,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-5（示例）",
   "answers": {
    "goals": [
     "industry"
    ],
    "interests": [
     "hiking",
     "fitness",
     "art"
    ],
    "field": "startup",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo06",
   "login_email": "demo06@demo.yale.edu",
   "contact_email": "demo6@example.com",
   "name": "周嘉怡",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "Founder @ 早期创业公司",
   "city": "New Haven",
   "contact_method": "微信 demo-6（示例）",
   "answers": {
    "goals": [
     "friends",
     "share"
    ],
    "interests": [
     "coffee",
     "film",
     "gaming",
     "fitness"
    ],
    "field": "public",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo07",
   "login_email": "demo07@demo.yale.edu",
   "contact_email": "demo7@example.com",
   "name": "吴昊天",
   "identity": "student",
   "stage": "master",
   "grad_year": 2027,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-7（示例）",
   "answers": {
    "goals": [
     "industry"
    ],
    "interests": [
     "tech",
     "cooking",
     "travel",
     "photo"
    ],
    "field": "academia",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo08",
   "login_email": "demo08@demo.yale.edu",
   "contact_email": "demo8@example.com",
   "name": "郑雨桐",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "Founder @ 早期创业公司",
   "city": "New Haven",
   "contact_method": "微信 demo-8（示例）",
   "answers": {
    "goals": [
     "friends",
     "share"
    ],
    "interests": [
     "running",
     "reading"
    ],
    "field": "data",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo09",
   "login_email": "demo09@demo.yale.edu",
   "contact_email": "demo9@example.com",
   "name": "钱晓晨",
   "identity": "student",
   "stage": "master",
   "grad_year": 2029,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-9（示例）",
   "answers": {
    "goals": [
     "academic"
    ],
    "interests": [
     "music",
     "fitness",
     "film",
     "podcasts"
    ],
    "field": "finance",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo10",
   "login_email": "demo10@demo.yale.edu",
   "contact_email": "demo10@example.com",
   "name": "冯一帆",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "PhD Student → Postdoc",
   "city": "New Haven",
   "contact_method": "微信 demo-10（示例）",
   "answers": {
    "goals": [
     "friends",
     "share"
    ],
    "interests": [
     "running",
     "gaming"
    ],
    "field": "arts",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo11",
   "login_email": "demo11@demo.yale.edu",
   "contact_email": "demo11@example.com",
   "name": "褚佳宁",
   "identity": "student",
   "stage": "phd",
   "grad_year": 2028,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-11（示例）",
   "answers": {
    "goals": [
     "industry"
    ],
    "interests": [
     "art",
     "fitness",
     "tech"
    ],
    "field": "data",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo12",
   "login_email": "demo12@demo.yale.edu",
   "contact_email": "demo12@example.com",
   "name": "卫子墨",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "Data Scientist",
   "city": "Shanghai",
   "contact_method": "微信 demo-12（示例）",
   "answers": {
    "goals": [
     "friends"
    ],
    "interests": [
     "tech",
     "cooking",
     "travel"
    ],
    "field": "law",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo13",
   "login_email": "demo13@demo.yale.edu",
   "contact_email": "demo13@example.com",
   "name": "蒋欣然",
   "identity": "student",
   "stage": "undergrad",
   "grad_year": 2027,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-13（示例）",
   "answers": {
    "goals": [
     "industry"
    ],
    "interests": [
     "reading",
     "hiking",
     "boardgames",
     "gaming"
    ],
    "field": "public",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo14",
   "login_email": "demo14@demo.yale.edu",
   "contact_email": "demo14@example.com",
   "name": "沈博文",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "Analyst @ 某投行",
   "city": "Shanghai",
   "contact_method": "微信 demo-14（示例）",
   "answers": {
    "goals": [
     "friends",
     "share"
    ],
    "interests": [
     "running",
     "food",
     "fitness",
     "investing"
    ],
    "field": "finance",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo15",
   "login_email": "demo15@demo.yale.edu",
   "contact_email": "demo15@example.com",
   "name": "韩若曦",
   "identity": "student",
   "stage": "master",
   "grad_year": 2029,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-15（示例）",
   "answers": {
    "goals": [
     "industry",
     "academic"
    ],
    "interests": [
     "reading",
     "ball"
    ],
    "field": "finance",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo16",
   "login_email": "demo16@demo.yale.edu",
   "contact_email": "demo16@example.com",
   "name": "杨天佑",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "PhD Student → Postdoc",
   "city": "Bay Area",
   "contact_method": "微信 demo-16（示例）",
   "answers": {
    "goals": [
     "share"
    ],
    "interests": [
     "tech",
     "reading"
    ],
    "field": "law",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo17",
   "login_email": "demo17@demo.yale.edu",
   "contact_email": "demo17@example.com",
   "name": "朱雅琪",
   "identity": "student",
   "stage": "master",
   "grad_year": 2028,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-17（示例）",
   "answers": {
    "goals": [
     "friends"
    ],
    "interests": [
     "investing",
     "gaming",
     "art",
     "ball"
    ],
    "field": "other",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo18",
   "login_email": "demo18@demo.yale.edu",
   "contact_email": "demo18@example.com",
   "name": "秦浩然",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "Product Manager",
   "city": "New York",
   "contact_method": "微信 demo-18（示例）",
   "answers": {
    "goals": [
     "share"
    ],
    "interests": [
     "coffee",
     "hiking"
    ],
    "field": "tech",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo19",
   "login_email": "demo19@demo.yale.edu",
   "contact_email": "demo19@example.com",
   "name": "许诺",
   "identity": "student",
   "stage": "phd",
   "grad_year": 2027,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-19（示例）",
   "answers": {
    "goals": [
     "friends"
    ],
    "interests": [
     "ball",
     "gaming",
     "fitness",
     "travel"
    ],
    "field": "tech",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo20",
   "login_email": "demo20@demo.yale.edu",
   "contact_email": "demo20@example.com",
   "name": "何以宁",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "Associate @ 某律所",
   "city": "Bay Area",
   "contact_method": "微信 demo-20（示例）",
   "answers": {
    "goals": [
     "friends"
    ],
    "interests": [
     "coffee",
     "gaming",
     "fitness",
     "film"
    ],
    "field": "law",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo21",
   "login_email": "demo21@demo.yale.edu",
   "contact_email": "demo21@example.com",
   "name": "吕知夏",
   "identity": "student",
   "stage": "master",
   "grad_year": 2029,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-21（示例）",
   "answers": {
    "goals": [
     "industry",
     "academic"
    ],
    "interests": [
     "art",
     "running",
     "coffee",
     "reading"
    ],
    "field": "public",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo22",
   "login_email": "demo22@demo.yale.edu",
   "contact_email": "demo22@example.com",
   "name": "施嘉禾",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "Associate @ 某律所",
   "city": "Beijing",
   "contact_method": "微信 demo-22（示例）",
   "answers": {
    "goals": [
     "friends"
    ],
    "interests": [
     "hiking",
     "running",
     "music",
     "coffee"
    ],
    "field": "biotech",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  },
  {
   "id": "u-demo23",
   "login_email": "demo23@demo.yale.edu",
   "contact_email": "demo23@example.com",
   "name": "张书言",
   "identity": "student",
   "stage": "master",
   "grad_year": 2028,
   "job": "",
   "city": "",
   "contact_method": "微信 demo-23（示例）",
   "answers": {
    "goals": [
     "industry",
     "academic"
    ],
    "interests": [
     "reading",
     "travel",
     "coffee",
     "podcasts"
    ],
    "field": "biotech",
    "intro": "在读，想多认识学长学姐，聊聊求职和生活。"
   }
  },
  {
   "id": "u-demo24",
   "login_email": "demo24@demo.yale.edu",
   "contact_email": "demo24@example.com",
   "name": "曹亦凡",
   "identity": "alumni",
   "stage": "",
   "grad_year": null,
   "job": "Data Scientist",
   "city": "Bay Area",
   "contact_method": "微信 demo-24（示例）",
   "answers": {
    "goals": [
     "share",
     "friends"
    ],
    "interests": [
     "travel",
     "fitness"
    ],
    "field": "other",
    "intro": "毕业几年了，很乐意分享经验。"
   }
  }
 ]
};
