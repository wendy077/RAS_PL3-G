const mongoose = require("mongoose");

const toolSchema = new mongoose.Schema({
  position: { type: Number, required: true },
  procedure: { type: String, required: true },
  params: { type: mongoose.Schema.Types.Mixed, required: true }, // This field can be any type of object
});

const imgSchema = new mongoose.Schema({
  og_uri: { type: String, required: true },
  new_uri: { type: String, required: true },
  og_img_key: { type: String, required: true },
  og_sha256: { type: String, required: true }, 
});


const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  imgs: { type: [imgSchema], default: [] },
  tools: { type: [toolSchema], default: [] },
  version: { type: Number, default: 0 },

  // número de ferramentas avançadas já “pagas” neste projeto
  chargedAdvancedTools: { type: Number, default: 0 },

  // nº de operações avançadas reservadas numa execução em curso
  // (serve só para saber quanto refund fazer em caso de cancel)
  pendingAdvancedOps: { type: Number, default: 0 },
  
  // campo de partilhas
  sharedLinks: [
    {
      id: { type: String, required: true }, // UUID usado no link
      permission: {
        type: String,
        enum: ["read", "edit"],
        default: "read",
      },
      createdAt: { type: Date, default: Date.now },
      revoked: { type: Boolean, default: false },
    },
  ],
});

module.exports = mongoose.model("project", projectSchema);
