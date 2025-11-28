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
});

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  imgs: { type: [imgSchema], default: [] },
  tools: { type: [toolSchema], default: [] },

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
