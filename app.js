const { Client, MessageMedia, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const { body, validationResult } = require("express-validator");
const socketIO = require("socket.io");
const qrcode = require("qrcode");
const http = require("http");

const fs = require("fs");
const util = require("util");

const { phoneNumberFormatter } = require("./helpers/formatter");
const fileUpload = require("express-fileupload");
const axios = require("axios");
const mime = require("mime-types");
const dotenv = require("dotenv");
var FormData = require("form-data");

const moment = require("moment-timezone");

const port = process.env.PORT || 8800;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

dotenv.config();

app.use(express.json());
app.use(
  express.urlencoded({
    extended: true,
  })
);

/**
 * BASED ON MANY QUESTIONS
 * Actually ready mentioned on the tutorials
 *
 * Many people confused about the warning for file-upload
 * So, we just disabling the debug for simplicity.
 */
app.use(
  fileUpload({
    debug: false,
  })
);

app.get("/", (req, res) => {
  res.sendFile("index.html", {
    root: __dirname,
  });
});

const client = new Client({
  restartOnAuthFail: true,
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process", // <- this one doesn't works in Windows
      "--disable-gpu",
    ],
  },
  authStrategy: new LocalAuth(),
});

function findVira(str) {
  return str.includes(".vira");
}

function toArabic(number) {
  const arabicNumerals = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  let result = "";
  for (let char of number.toString()) {
    result += arabicNumerals[char];
  }
  return result;
}

// TEXT-TO-SPEECH
const textToSpeech = require("@google-cloud/text-to-speech");

const client_speech = new textToSpeech.TextToSpeechClient();

async function convertTextToMp3(text, file_suara, speech, voice, gender) {
  let languageCode = "id-ID";
  let voiceName = "id-ID-Wavenet-A";
  let ssmlGender = "FEMALE";
  if (speech) {
    languageCode = speech;
  }
  if (voice) {
    voiceName = voice;
  }
  if (gender) {
    ssmlGender = gender;
  }
  const req = {
    input: { text },
    voice: {
      languageCode,
      ssmlGender,
      voiceName,
    },
    audioConfig: { audioEncoding: "MP3" },
  };

  const [response] = await client_speech.synthesizeSpeech(req);

  const writeFile = util.promisify(fs.writeFile);

  await writeFile(file_suara, response.audioContent, "binary");

  console.log("text to speech berhasil");
}

// SPEECH TO TEXT
const speech = require("@google-cloud/speech");

const clientStT = new speech.SpeechClient();

async function speechToText(audio_url) {
  // console.log(audio_url);
  const file = fs.readFileSync("./test.flac");
  const audioBytes = file.toString("base64");

  // The audio file's encoding, sample rate in hertz, and BCP-47 language code
  const audio = {
    content: audioBytes,
  };
  const config = {
    encoding: "FLAC",
    sampleRateHertz: 24000,
    languageCode: "id-ID",
  };
  const request = {
    audio: audio,
    config: config,
  };

  // Detects speech in the audio file
  const [response] = await clientStT.recognize(request);
  const transcription = response.results
    .map((result) => result.alternatives[0].transcript)
    .join("\n");
  // console.log(`Transcription: ${transcription}`);
  return transcription;
}

//GOOGLE TRANSLATE
const { Translate } = require("@google-cloud/translate").v2;

const projectId = "teak-amphora-364409";
const translate = new Translate({ projectId });

async function googleTranslate(text, target) {
  const [translation] = await translate.translate(text, target);
  return translation;
}

// QURAN
async function quran(data) {
  const response = await axios.get(
    `https://api.npoint.io/99c279bb173a6e28359c/surat/${data.surat}/${
      parseInt(data.ayat) - 1
    }`
  );
  return response.data;
}

// HADITS
async function hadits(data) {
  const response = await axios.get(
    `https://hadis-api-id.vercel.app/hadith/${data.perawi.replace(
      " ",
      ""
    )}/${parseInt(data.no_hadits)}`
  );
  return response.data;
}

// OPEN AI
const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

client.on("message", async (msg) => {
  if (msg.hasMedia && msg.body.includes("hapus")) {
    const media = await msg.downloadMedia();
    const fileName = Date.now() + ".jpg";
    try {
      fs.writeFile("./media/" + fileName, media.data, "base64", function (err) {
        if (err) {
          console.log(err);
        }
      });
    } catch (error) {
      console.log(error);
    }

    var data = new FormData();
    data.append("image_file", fs.createReadStream("./media/" + fileName));

    var config = {
      method: "post",
      url: "https://api.removal.ai/3.0/remove",
      headers: {
        "Rm-Token": process.env.REMOVE_AI_API_KEY,
        ...data.getHeaders(),
      },
      data: data,
    };
    axios(config)
      .then(async function (response) {
        const media = await MessageMedia.fromUrl(response.data.url);
        msg.reply(media);
        fs.unlink("./media/" + fileName);
      })
      .catch(function (error) {
        console.log(error);
      });
  } else if (msg.body.includes(".hadits")) {
    const pesan = msg.body.split(":");
    const data = pesan[1].split("/");
    if (!pesan[1] && !data[0] && !data[1]) {
      return msg.reply(
        "pastikan perintah yang anda tulis sudah benar\n\ncontoh :\n.hadits : bukhari/1\n\nketerangan:\nbukhari = Nama Perawi\n1 = nomor hadits\n\npastikan nama perawi sesuai dengan kode perawi dibawah ini:\n\nDaftar Kode Perawi : \n1.abu-dawud\n2.ahmad\n3.bukhari\n4.darimi\n5.ibnu-majah\n6.malik\n7.muslim\n8.nasai\n9.tirmidzi"
      );
    }
    hadits({ perawi: String(data[0]).toLowerCase(), no_hadits: data[1] })
      .then((data) => {
        const pesan = `Perawi: ${data.name}\nHadits No : ${data.number}\n\n${data.arab}\n\n${data.id}`;
        msg.reply(pesan);
        const file_suara = Date.now() + ".mp3";
        convertTextToMp3(
          data.arab,
          file_suara,
          "ar-EG",
          "ar-XA-Wavenet-C",
          "MALE"
        ).then(() => {
          try {
            const media = MessageMedia.fromFilePath(file_suara);
            client.sendMessage(msg.from, media);
            if (fs.existsSync(file_suara)) {
              fs.unlinkSync(file_suara);
            }
          } catch (error) {
            console.log(error);
          }
        });
      })
      .catch((err) => {
        console.log(err);
        msg.reply(
          "kami tidak dapat menemukan nama perawi atau nomor hadits yang anda cari\n\npastikan perintah yang anda tulis sudah benar\n\ncontoh :\n.hadits : bukhari/1\n\nketerangan:\nbukhari = Nama Perawi\n1 = nomor hadits\n\npastikan nama perawi sesuai dengan kode perawi dibawah ini:\n\nDaftar Kode Perawi : \n1.abu-dawud\n2.ahmad\n3.bukhari\n4.darimi\n5.ibnu-majah\n6.malik\n7.muslim\n8.nasai\n9.tirmidzi"
        );
      });
  } else if (msg.body.includes(".quran")) {
    const pesan = msg.body.split(":");
    const data = pesan[1].split("/");
    if (!pesan[1] && !data[0] && !data[1]) {
      return msg.reply(
        "pastikan perintah yang anda tulis sudah benar\n\ncontoh :\n.quran : 1/3\n\nketerangan:\n1 = nomor surat\n3 = nomor ayat"
      );
    }
    quran({ surat: data[0], ayat: data[1] })
      .then((data) => {
        const pesan = `${data.ar}\n\nartinya : _${data.id}_ (${data.nomor})`;
        msg.reply(pesan);
      })
      .catch((err) => {
        console.log(err);
        msg.reply(
          "kami tidak dapat menemukan nomor surat atau nomor ayat yang anda cari\n\npastikan perintah yang anda tulis sudah benar\n\ncontoh :\n.quran : 1/3\n\nketerangan:\n1 = nomor surat\n3 = nomor ayat"
        );
      });
  } else if (msg.body.includes(".translate")) {
    const pesan = msg.body.split(":");
    const target = pesan[0].split(" ");
    if (!target[1]) {
      return msg.reply(
        "Untuk saat ini hanya dapat menterjemahkan ke bahasa Arab, Inggris, Korea, Indonesia\n\npastikan perintah yang kamu buat sudah benar seperti contoh berikut :\n\n.translate arab : semoga hari ini berjalan lancar"
      );
    }
    let lang = "";
    let speech = "";
    let voice = "";
    let gender = "";
    switch (target[1].toLowerCase()) {
      case "arab":
        lang = "ar";
        speech = "ar-EG";
        voice = "ar-XA-Wavenet-C";
        gender = "MALE";
        break;
      case "inggris":
        lang = "en";
        speech = "en-US";
        voice = "en-US-Neural2-H";
        gender = "FEMALE";
        break;
      case "korea":
        lang = "ko";
        speech = "ko-KR";
        voice = "ko-KR-Wavenet-A";
        gender = "FEMALE";
        break;
      case "indonesia":
        lang = "id";
        speech = "id-ID";
        break;
      default:
        lang = "";
        break;
    }
    if (!lang) {
      return msg.reply(
        "Untuk saat ini hanya dapat menterjemahkan ke bahasa Arab, Inggris, Korea, Indonesia\n\npastikan perintah yang kamu buat sudah benar seperti contoh berikut :\n\n.translate arab : semoga hari ini berjalan lancar"
      );
    }
    googleTranslate(pesan[1], lang).then((data) => {
      console.log("translate berhasil");
      msg.reply(data);
      if (speech) {
        const file_suara = Date.now() + ".mp3";
        convertTextToMp3(data, file_suara, speech, voice, gender).then(() => {
          try {
            const media = MessageMedia.fromFilePath(file_suara);
            client.sendMessage(msg.from, media);
            if (fs.existsSync(file_suara)) {
              fs.unlinkSync(file_suara);
            }
          } catch (error) {
            console.log(error);
          }
        });
      }
    });
  }
  if (msg.body === ".vira" || msg.body === "vira" || msg.body === "vira ") {
    const file_suara = Date.now() + ".mp3";
    const pesan =
      "Halo saya VIRA, Virtual Information Research Assistent.\nsilahkan tanyakan apapun kepada saya dengan menambahkan kata titik vira diawal pertanyaan anda.\n\ncontoh:\n.vira apa nama ibukota indonesia?";
    convertTextToMp3(pesan, file_suara).then(() => {
      try {
        const media = MessageMedia.fromFilePath(file_suara);
        client.sendMessage(msg.from, media);
        if (fs.existsSync(file_suara)) {
          fs.unlinkSync(file_suara);
        }
      } catch (error) {
        console.log(error);
      }
    });
  } else if (msg.body.includes(".hijriah")) {
    await axios
      .get(
        "https://api.aladhan.com/v1/gToH?date=" +
          moment(new Date()).format("DD-MM-YYYY")
      )
      .then((res) => {
        console.log(res.data.data);
        msg.reply(
          `hari ini ${res.data.data.hijri.day} ${
            res.data.data.hijri.month.en
          } ${res.data.data.hijri.year} H  \n ${
            res.data.data.hijri.weekday.ar
          }, ${toArabic(res.data.data.hijri.day)} ${
            res.data.data.hijri.month.ar
          } ${toArabic(res.data.data.hijri.year)} ه`
        );
      });
  } else if (findVira(msg.body) == true) {
    try {
      const response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: msg.body.replace(/.vira/gi, ""),
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      });
      const file_suara = Date.now() + ".mp3";
      if (String(response.data.choices[0].text).length < 500) {
        convertTextToMp3(response.data.choices[0].text, file_suara).then(() => {
          try {
            const media = MessageMedia.fromFilePath(file_suara);
            client.sendMessage(msg.from, media);
            if (fs.existsSync(file_suara)) {
              fs.unlinkSync(file_suara);
            }
          } catch (error) {
            console.log(error);
          }
        });
      } else {
        try {
          msg.reply(response.data.choices[0].text);
        } catch (error) {
          console.log(error);
        }
      }
    } catch (error) {
      msg.reply(
        "maaf, .vira untuk saat ini tidak tersedia. silahkan coba beberapa saat lagi"
      );
    }
  }
  if (msg.body == "!ping") {
    msg.reply("pong");
  } else if (msg.body == "good morning") {
    msg.reply("selamat pagi");
  } else if (msg.body == "!groups") {
    client.getChats().then((chats) => {
      const groups = chats.filter((chat) => chat.isGroup);

      if (groups.length == 0) {
        msg.reply("You have no group yet.");
      } else {
        let replyMsg = "*YOUR GROUPS*\n\n";
        groups.forEach((group, i) => {
          replyMsg += `ID: ${group.id._serialized}\nName: ${group.name}\n\n`;
        });
        replyMsg +=
          "_You can use the group id to send a message to the group._";
        msg.reply(replyMsg);
      }
    });
  }
});
0;
client.initialize();

// Socket IO
io.on("connection", function (socket) {
  socket.emit("message", "Connecting...");

  client.on("qr", (qr) => {
    console.log("QR RECEIVED", qr);
    qrcode.toDataURL(qr, (err, url) => {
      socket.emit("qr", url);
      socket.emit("message", "QR Code received, scan please!");
    });
  });

  client.on("ready", () => {
    socket.emit("ready", "Whatsapp is ready!");
    socket.emit("message", "Whatsapp is ready!");
  });

  client.on("authenticated", () => {
    socket.emit("authenticated", "Whatsapp is authenticated!");
    socket.emit("message", "Whatsapp is authenticated!");
    console.log("AUTHENTICATED");
  });

  client.on("auth_failure", function (session) {
    socket.emit("message", "Auth failure, restarting...");
  });

  client.on("disconnected", (reason) => {
    socket.emit("message", "Whatsapp is disconnected!");
    client.destroy();
    client.initialize();
  });
});

const checkRegisteredNumber = async function (number) {
  const isRegistered = await client.isRegisteredUser(number);
  return isRegistered;
};

// Send message
app.post(
  "/send-message",
  [body("number").notEmpty(), body("message").notEmpty()],
  async (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped(),
      });
    }

    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;

    const isRegisteredNumber = await checkRegisteredNumber(number);

    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: "The number is not registered",
      });
    }

    client
      .sendMessage(number, message)
      .then((response) => {
        res.status(200).json({
          status: true,
          response: response,
        });
      })
      .catch((err) => {
        res.status(500).json({
          status: false,
          response: err,
        });
      });
  }
);

// Send media
app.post("/send-media", async (req, res) => {
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  let mimetype;
  const attachment = await axios
    .get(fileUrl, {
      responseType: "arraybuffer",
    })
    .then((response) => {
      mimetype = response.headers["content-type"];
      return response.data.toString("base64");
    });

  const media = new MessageMedia(mimetype, attachment, "Media");

  client
    .sendMessage(number, media, {
      caption: caption,
    })
    .then((response) => {
      res.status(200).json({
        status: true,
        response: response,
      });
    })
    .catch((err) => {
      res.status(500).json({
        status: false,
        response: err,
      });
    });
});

const findGroupByName = async function (name) {
  const group = await client.getChats().then((chats) => {
    return chats.find(
      (chat) => chat.isGroup && chat.name.toLowerCase() == name.toLowerCase()
    );
  });
  return group;
};

// Send message to group
// You can use chatID or group name, yea!
app.post(
  "/send-group-message",
  [
    body("id").custom((value, { req }) => {
      if (!value && !req.body.name) {
      }
      throw new Error("Invalid value, you can use `id` or `name`");

      return true;
    }),
    body("message").notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped(),
      });
    }

    let chatId = req.body.id;
    const groupName = req.body.name;
    const message = req.body.message;

    // Find the group by name
    if (!chatId) {
      const group = await findGroupByName(groupName);
      if (!group) {
        return res.status(422).json({
          status: false,
          message: "No group found with name: " + groupName,
        });
      }
      chatId = group.id._serialized;
    }

    client
      .sendMessage(chatId, message)
      .then((response) => {
        res.status(200).json({
          status: true,
          response: response,
        });
      })
      .catch((err) => {
        res.status(500).json({
          status: false,
          response: err,
        });
      });
  }
);

// Clearing message on spesific chat
app.post("/clear-message", [body("number").notEmpty()], async (req, res) => {
  const errors = validationResult(req).formatWith(({ msg }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped(),
    });
  }

  const number = phoneNumberFormatter(req.body.number);

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: "The number is not registered",
    });
  }

  const chat = await client.getChatById(number);

  chat
    .clearMessages()
    .then((status) => {
      res.status(200).json({
        status: true,
        response: status,
      });
    })
    .catch((err) => {
      res.status(500).json({
        status: false,
        response: err,
      });
    });
});

server.listen(port, function () {
  console.log("App running on *: " + port);
});
