var express = require("express");
var router = express.Router();
const axios = require("axios");

const multer = require("multer");
const FormData = require("form-data");

const fs = require("fs");
const fs_extra = require("fs-extra");
const path = require("path");
const mime = require("mime-types");

const JSZip = require("jszip");

const { v4: uuidv4 } = require('uuid');

const {
  send_msg_tool,
  send_msg_client,
  send_msg_client_error,
  send_msg_client_preview,
  send_msg_client_preview_error,
  read_msg,
} = require("../utils/project_msg");

const Project = require("../controllers/project");
const Process = require("../controllers/process");
const Result = require("../controllers/result");
const Preview = require("../controllers/preview");
const jwt = require("jsonwebtoken");

const {
  get_image_docker,
  get_image_host,
  post_image,
  delete_image,
} = require("../utils/minio");

const {
  checkSharePermission,
  requireEditPermission
} = require("../middleware/shareAuth");

const { requireProjectVersion } = require("../middleware/projectVersion");

const storage = multer.memoryStorage();
var upload = multer({ storage: storage });

const key = fs.readFileSync(__dirname + "/../certs/selfsigned.key");
const cert = fs.readFileSync(__dirname + "/../certs/selfsigned.crt");

const https = require("https");
const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // (NOTE: this will disable client verification)
  cert: cert,
  key: key,
});

const users_ms = "https://users:10001/";
const minio_domain = process.env.MINIO_DOMAIN;

const advanced_tools = [
  "cut_ai",
  "upgrade_ai",
  "bg_remove_ai",
  "text_ai",
  "obj_ai",
  "people_ai",
  "expand_ai",
];

// Conta quantas ferramentas avançadas existem neste projeto (independente de imagens)
function count_advanced_tools(project) {
  const tools = project.tools || [];
  return tools.filter((t) => advanced_tools.includes(t.procedure)).length;
}

function requireOwner(req, res, next) {
  const caller = getCallerId(req);
  if (String(caller) !== String(req.params.user)) {
    return res.status(403).jsonp("Not allowed");
  }
  next();
}


/**
 * Calcula quantas operações avançadas vão ser usadas *nesta execução*.
 * - totalAdv: nº total de tools avançadas atualmente no projeto
 * - charged: nº de tools avançadas já “pagas” (clamped para nunca ser > totalAdv)
 * - newTools: nº de tools avançadas novas desde a última vez que foram pagas
 * - adv_ops: nº de operações a debitar no users-ms (= newTools * nº de imagens)
 */
function advanced_tool_num(project) {
  const totalAdv = count_advanced_tools(project);
  let charged = project.chargedAdvancedTools || 0;

  // Se o utilizador apagou tools avançadas depois de pagar, 
  // garantimos que charged nunca é maior que o total atual.
  if (charged > totalAdv) charged = totalAdv;

  const newTools = totalAdv - charged;
  const adv_ops = newTools > 0 ? newTools * project.imgs.length : 0;

  return { totalAdv, charged, newTools, adv_ops };
}
function getCallerId(req) {
  // 1) se o api-gateway mandar x-caller-id, usa
  const forwarded = req.headers["x-caller-id"];
  if (forwarded) return forwarded;

  // 2) senão, extrai do JWT Authorization (SEM verify)
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    const payload = jwt.decode(token);
    if (payload?.id) return payload.id;
  }

  // 3) fallback: owner
  return req.params.user;
}

// TODO process message according to type of output
function process_msg() {
  read_msg(async (msg) => {
    try {
      const msg_content = JSON.parse(msg.content.toString());
      const msg_id = msg_content.correlationId;
      const timestamp = new Date().toISOString();

      const user_msg_id = `update-client-process-${uuidv4()}`;

      const process = await Process.getOneByMsgId(msg_id);

      if (!process) {
        return;
      }
      const ownerId = process.user_id;
      const runnerId = process.runner_id || process.user_id; 

      const prev_process_input_img = process.og_img_uri;
      const prev_process_output_img = process.new_img_uri;
      
      // Get current process, delete it and create it's sucessor if possible
      const og_img_uri = process.og_img_uri;
      const img_id = process.img_id;
      
      await Process.delete(process.user_id, process.project_id, process._id);
      
      if (msg_content.status === "error") {
        console.log(JSON.stringify(msg_content));
        if (/preview/.test(msg_id)) {
          send_msg_client_preview_error(`update-client-preview-${uuidv4()}`, timestamp, runnerId, msg_content.error.code, msg_content.error.msg)
        }
        
        else {
          send_msg_client_error(
            user_msg_id,
            timestamp,
            runnerId,   
            msg_content.error.code,
            msg_content.error.msg
          );
        }
        return;
      }
      
      const output_file_uri = msg_content.output.imageURI;
      const type = msg_content.output.type;
      const project = await Project.getOne(process.user_id, process.project_id);

      const next_pos = process.cur_pos + 1;

      if (/preview/.test(msg_id) && (type == "text" || next_pos >= project.tools.length)) {
        const file_path = path.join(__dirname, `/../${output_file_uri}`);
        const file_name = path.basename(file_path);
        const fileStream = fs.createReadStream(file_path); // Use createReadStream for efficiency

        const data = new FormData();
        await data.append(
          "file",
          fileStream,
          path.basename(file_path),
          mime.lookup(file_path)
        );

        const resp = await post_image(
          process.user_id,
          process.project_id,
          "preview",
          data
        );

        const og_key_tmp = resp.data.data.imageKey.split("/");
        const og_key = og_key_tmp[og_key_tmp.length - 1];

        
        const preview = {
          type: type,
          file_name: file_name,
          img_key: og_key,
          img_id: img_id,
          project_id: process.project_id,
          user_id: process.user_id,
        };
        
        await Preview.create(preview);

        if(next_pos >= project.tools.length){
          const previews = await Preview.getAll(process.user_id, process.project_id);

          let urls = {
            'imageUrl': '',
            'textResults': []
          };

          for(let p of previews){
            const url_resp = await get_image_host(
              process.user_id,
              process.project_id,
              "preview",
              p.img_key
            );

            const url = url_resp.data.url;

            if(p.type != "text") urls.imageUrl = url;

            else urls.textResults.push(url);
          }
          
          send_msg_client_preview(
            `update-client-preview-${uuidv4()}`,
            timestamp,
            runnerId,
            JSON.stringify(urls)
          );

        }
      }

      if(/preview/.test(msg_id) && next_pos >= project.tools.length) return;

      if (!/preview/.test(msg_id))
        send_msg_client(
          user_msg_id,
          timestamp,
          runnerId
        );

      if (!/preview/.test(msg_id) && (type == "text" || next_pos >= project.tools.length)) {
        const file_path = path.join(__dirname, `/../${output_file_uri}`);
        const file_name = path.basename(file_path);
        const fileStream = fs.createReadStream(file_path); // Use createReadStream for efficiency

        const data = new FormData();
        await data.append(
          "file",
          fileStream,
          path.basename(file_path),
          mime.lookup(file_path)
        );

        const resp = await post_image(
          process.user_id,
          process.project_id,
          "out",
          data
        );

        const og_key_tmp = resp.data.data.imageKey.split("/");
        const og_key = og_key_tmp[og_key_tmp.length - 1];

        const result = {
          type: type,
          file_name: file_name,
          img_key: og_key,
          img_id: img_id,
          project_id: process.project_id,
          user_id: process.user_id,
        };

        await Result.create(result);
      }

      if (next_pos >= project.tools.length) return;

      const new_msg_id = /preview/.test(msg_id)
        ? `preview-${uuidv4()}`
        : `request-${uuidv4()}`;

      const tool = project.tools.filter((t) => t.position == next_pos)[0];

      const tool_name = tool.procedure;
      const params = tool.params;

      const read_img = type == "text" ? prev_process_input_img : output_file_uri;
      const output_img = type == "text" ? prev_process_output_img : output_file_uri;

      const new_process = {
        user_id: project.user_id,
        runner_id: runnerId,       
        project_id: project._id,
        img_id: img_id,
        msg_id: new_msg_id,
        cur_pos: next_pos,
        og_img_uri: read_img,
        new_img_uri: output_img,
      };

      // Making sure database entry is created before sending message to avoid conflicts
      await Process.create(new_process);
      send_msg_tool(
        new_msg_id,
        timestamp,
        new_process.og_img_uri,
        new_process.new_img_uri,
        tool_name,
        params
      );
    } catch (_) {
      send_msg_client_error(
        user_msg_id,
        timestamp,
        process.user_id,
        "30000",
        "An error happened while processing the project"
      );
      return;
    }
  });
}

async function deleteProjectAndResources(userId, projectId) {
  const project = await Project.getOne(userId, projectId);

  // apagar imagens
  const previous_img = JSON.parse(JSON.stringify(project["imgs"]));
  for (let img of previous_img) {
    await delete_image(userId, projectId, "src", img.og_img_key);
    project["imgs"].remove(img);
  }

  // apagar resultados
  const results = await Result.getAll(userId, projectId);
  for (let r of results) {
    await delete_image(userId, projectId, "out", r.img_key);
    await Result.delete(r.user_id, r.project_id, r.img_id);
  }

  // apagar previews
  const previews = await Preview.getAll(userId, projectId);
  for (let p of previews) {
    await delete_image(userId, projectId, "preview", p.img_key);
    await Preview.delete(p.user_id, p.project_id, p.img_id);
  }

  // apagar o próprio projeto
  await Project.delete(userId, projectId);
}

// ================== SHARING / LINKS ==================

// listar links de partilha de um projeto (para o dono)
router.get("/:user/:project/share", requireOwner, async (req, res) => {
  try {
    const project = await Project.getOne(req.params.user, req.params.project);

    const sharedLinks = (project.sharedLinks || []).map((l) => ({
      id: l.id,
      permission: l.permission,
      createdAt: l.createdAt,
      revoked: l.revoked,
    }));

    return res.status(200).jsonp(sharedLinks);
  } catch (err) {
    console.error("Error listing shared links:", err);
    return res.status(500).jsonp("Error listing shared links");
  }
});

// criar um novo link de partilha
router.post("/:user/:project/share", requireOwner, requireProjectVersion, async (req, res) => {
  try {
    const permission = req.body.permission === "edit" ? "edit" : "read";

    const newLink = {
      id: uuidv4(),
      permission,
      createdAt: new Date(),
      revoked: false,
    };

    const updated = await Project.addShareLinkIfVersion(
      req.params.user,
      req.params.project,
      newLink,
      req.expectedVersion
    );

    if (!updated) {
      const fresh = await Project.getOne(req.params.user, req.params.project);
      if (!fresh) return res.status(404).jsonp("Project not found");
      return res.status(409).jsonp({
        message: "Project version conflict",
        serverVersion: fresh?.version ?? null,
      });
    }

    res.set("X-Project-Version", String(updated.version));

    const frontendBase = process.env.FRONTEND_BASE_URL || "http://localhost:8080";
    const url = `${frontendBase}/share/${newLink.id}`;

    return res.status(201).jsonp({ ...newLink, url });
  } catch (err) {
    console.error("Error creating shared link:", err);
    return res.status(500).jsonp("Error creating shared link");
  }
});


// resolver um link de partilha (usado por convidados)
router.get("/share/:shareId", async (req, res) => {
  try {
    const project = await Project.getOneByShareId(req.params.shareId);

    if (!project) {
      return res.status(404).jsonp("Share link not found");
    }

    const link = (project.sharedLinks || []).find(
      (l) => l.id === req.params.shareId,
    );

    if (!link) {
      return res.status(404).jsonp("Share link not found");
    }

    if (link.revoked) {
      return res.status(410).jsonp("Share link revoked");
    }

    return res.status(200).jsonp({
      projectId: project._id,
      ownerId: project.user_id,
      permission: link.permission,
      projectName: project.name,
    });
  } catch (err) {
    console.error("Error resolving share link:", err);
    return res.status(500).jsonp("Error resolving share link");
  }
});

// devolver projeto completo (imgs + tools) via shareId, sem precisar do owner
router.get("/share/:shareId/project", async (req, res) => {
  try {
    const project = await Project.getOneByShareId(req.params.shareId);

    if (!project) {
      return res.status(404).jsonp("Share link not found");
    }

    const link = (project.sharedLinks || []).find(
      (l) => l.id === req.params.shareId,
    );

    if (!link) {
      return res.status(404).jsonp("Share link not found");
    }

    if (link.revoked) {
      return res.status(410).jsonp("Share link revoked");
    }

    // estrutura semelhante ao GET "/:user/:project"
    const response = {
      _id: project._id,
      user_id: project.user_id,
      name: project.name,
      tools: project.tools,
      imgs: [],
      permission: link.permission,
      version: project.version, 
      chargedAdvancedTools: project.chargedAdvancedTools || 0,
      pendingAdvancedOps: project.pendingAdvancedOps || 0,
    };

    // tentar usar resultados mais recentes
    const results = await Result.getAll(project.user_id, project._id);
    const imageResults = results.filter((r) => r.type !== "text");

    if (imageResults.length > 0) {
      // usar imagens editadas
      for (const r of imageResults) {
        try {
          const resp = await get_image_host(
            r.user_id,
            r.project_id,
            "out",
            r.img_key,
          );
          const url = resp.data.url;

          response.imgs.push({
            _id: r.img_id,
            name: r.file_name,
            url,
          });
        } catch (err) {
          console.error("Error getting result image url for shared project:", err);
          return res.status(500).jsonp("Error getting image url");
        }
      }
    } else {
      // fallback: imagens originais
      for (const img of project.imgs) {
        try {
          const resp = await get_image_host(
            project.user_id,
            project._id,
            "src",
            img.og_img_key,
          );
          const url = resp.data.url;

          response.imgs.push({
            _id: img._id,
            name: path.basename(img.og_uri),
            url,
          });
        } catch (err) {
          console.error("Error getting image url for shared project:", err);
          return res.status(500).jsonp("Error getting image url");
        }
      }
    }

    return res.status(200).jsonp(response);
  } catch (err) {
    console.error("Error getting shared project:", err);
    return res.status(500).jsonp("Error getting shared project");
  }
});

// revogar um link de partilha
router.delete("/:user/:project/share/:shareId", requireOwner, requireProjectVersion, async (req, res) => {
  try {
    const { user, project, shareId } = req.params;
    const expected = req.expectedVersion;

    //  valida que o link existe no projeto carregado
    const link = req.projectDoc?.sharedLinks?.find((l) => l.id === shareId);
    if (!link) return res.status(404).jsonp("Share link not found");
    if (link.revoked) return res.status(410).jsonp("Share link revoked");

    const updated = await Project.revokeShareLinkIfVersion(user, project, shareId, expected);

    if (!updated) {
      const fresh = await Project.getOne(user, project);
      if (!fresh) return res.status(404).jsonp("Project not found");

      // conflito de versão
      if (fresh.version !== expected) {
        return res.status(409).jsonp({
          message: "Project version conflict",
          serverVersion: fresh.version,
        });
      }

      // mesma versão mas não atualizou -> link não existe / já revogado
      return res.status(404).jsonp("Share link not found");
    }

    res.set("X-Project-Version", String(updated.version));
    return res.sendStatus(204);
  } catch (err) {
    console.error("Error revoking share link:", err);
    return res.status(500).jsonp("Error revoking share link");
  }
});


// ================== FIM SHARING ==================

// Get list of all projects from a user
router.get("/:user", (req, res, next) => {
  Project.getAll(req.params.user)
    .then((projects) => {
      const ans = [];

      for (let p of projects) {
        ans.push({
          _id: p._id,
          name: p.name,
          version: p.version
        });
      }

      res.status(200).jsonp(ans);
    })
    .catch((_) => res.status(500).jsonp("Error acquiring user's projects"));
});

// Get a specific user's project
router.get("/:user/:project", checkSharePermission, (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      const response = {
        _id: project._id,
        name: project.name,
        tools: project.tools,
        imgs: [],
        version: project.version,
      };

      for (let img of project.imgs) {
        try {
          const resp = await get_image_host(
            req.params.user,
            req.params.project,
            "src",
            img.og_img_key
          );
          const url = resp.data.url;

          response["imgs"].push({
            _id: img._id,
            name: path.basename(img.og_uri),
            url: url,
          });
        } catch (_) {
          res.status(404).jsonp(`Error acquiring image's url`);
          return;
        }
      }

      res.status(200).jsonp(response);
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Get a specific project's image
router.get("/:user/:project/img/:img", checkSharePermission, async (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      try {
        const img = project.imgs.filter((i) => i._id == req.params.img)[0];
        const resp = await get_image_host(
          req.params.user,
          req.params.project,
          "src",
          img.og_img_key
        );
        res.status(200).jsonp({
          _id: img._id,
          name: path.basename(img.og_uri),
          url: resp.data.url,
        });
      } catch (_) {
        res.status(404).jsonp("No image with such id.");
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Get project images
router.get("/:user/:project/imgs", checkSharePermission, async (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      try {
        const ans = [];

        for (let img of project.imgs) {
          try {
            const resp = await get_image_host(
              req.params.user,
              req.params.project,
              "src",
              img.og_img_key
            );
            const url = resp.data.url;

            ans.push({
              _id: img._id,
              name: path.basename(img.og_uri),
              url: url,
            });
          } catch (_) {
            res.status(404).jsonp(`Error acquiring image's url`);
            return;
          }
        }
        res.status(200).jsonp(ans);
      } catch (_) {
        res.status(404).jsonp("No image with such id.");
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Get results of processing a project
router.get("/:user/:project/process", checkSharePermission, (req, res, next) => {
  // Getting last processed request from project in order to get their result's path

  Project.getOne(req.params.user, req.params.project)
    .then(async (_) => {
      const zip = new JSZip();
      const results = await Result.getAll(req.params.user, req.params.project);

      const result_path = `/../images/users/${req.params.user}/projects/${req.params.project}/tmp`;

      fs.mkdirSync(path.join(__dirname, result_path), { recursive: true });

      for (let r of results) {
        const res_path = path.join(__dirname, result_path, r.file_name);

        const resp = await get_image_docker(
          r.user_id,
          r.project_id,
          "out",
          r.img_key
        );
        const url = resp.data.url;

        const file_resp = await axios.get(url, { responseType: "stream" });
        const writer = fs.createWriteStream(res_path);

        // Use a Promise to handle the stream completion
        await new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
          file_resp.data.pipe(writer); // Pipe AFTER setting up the event handlers
        });

        const fs_res = fs.readFileSync(res_path);
        zip.file(r.file_name, fs_res);
      }

      fs.rmSync(path.join(__dirname, result_path), {
        recursive: true,
        force: true,
      });

      const ans = await zip.generateAsync({ type: "blob" });

      res.type(ans.type);
      res.set(
        "Content-Disposition",
        `attachment; filename=user_${req.params.user}_project_${req.params.project}_results.zip`
      );
      const b = await ans.arrayBuffer();
      res.status(200).send(Buffer.from(b));
    })
    .catch((_) =>
      res.status(601).jsonp(`Error acquiring project's processing result`)
    );
});


// Get results of processing a project
router.get("/:user/:project/process/url", checkSharePermission, (req, res, next) => {
  // Getting last processed request from project in order to get their result's path

  Project.getOne(req.params.user, req.params.project)
    .then(async (_) => {
      const ans = {
        'imgs': [],
        'texts': []
      };
      const results = await Result.getAll(req.params.user, req.params.project);

      for (let r of results) {
        const resp = await get_image_host(
          r.user_id,
          r.project_id,
          "out",
          r.img_key
        );
        const url = resp.data.url;

        if(r.type == 'text') ans.texts.push({ og_img_id : r.img_id, name: r.file_name, url: url })

        else ans.imgs.push({ og_img_id : r.img_id, name: r.file_name, url: url })
      }

      res.status(200).jsonp(ans);
    })
    .catch((_) =>
      res.status(601).jsonp(`Error acquiring project's processing result`)
    );
});


// Get number of advanced tools used in a project
router.get("/:user/:project/advanced_tools", checkSharePermission, (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then((project) => {
      const { adv_ops } = advanced_tool_num(project);
      // nº de operações avançadas que ESTA execução iria gastar
      res.status(200).jsonp(adv_ops);
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Create new project
router.post("/:user", (req, res, next) => {
  const project = {
    name: req.body.name,
    user_id: req.params.user,
    imgs: [],
    tools: [],
  };

  Project.create(project)
    .then((project) => res.status(201).jsonp(project))
    .catch((_) => res.status(502).jsonp(`Error creating new project`));
});

// Preview an image
router.post("/:user/:project/preview/:img", checkSharePermission, requireEditPermission, (req, res, next) => {
  const ownerId = req.params.user;
  const runnerUserId = getCallerId(req);

  Project.getOne(ownerId, req.params.project)
    .then(async (project) => {
      if (project.tools.length === 0) {
        return res.status(400).jsonp("No tools selected");
      }

      const tool = project.tools.filter((t) => t.position == 0)[0];
      if (!tool) {
        return res.status(400).jsonp("No tools selected");
      }

      const tool_name = tool.procedure;
      const params = tool.params;

      const prev_preview = await Preview.getAll(
        ownerId,
        req.params.project
      );

      for (let p of prev_preview) {
        await delete_image(
          ownerId,
          req.params.project,
          "preview",
          p.img_key
        );
        await Preview.delete(
          ownerId,
          req.params.project,
          p.img_id
        );
      }

      const source_path = `/../images/users/${ownerId}/projects/${req.params.project}/src`;
      const result_path = `/../images/users/${ownerId}/projects/${req.params.project}/preview`;

      if (!fs.existsSync(path.join(__dirname, source_path)))
        fs.mkdirSync(path.join(__dirname, source_path), { recursive: true });

      if (!fs.existsSync(path.join(__dirname, result_path)))
        fs.mkdirSync(path.join(__dirname, result_path), { recursive: true });

      const img = project.imgs.filter((i) => i._id == req.params.img)[0];
      const msg_id = `preview-${uuidv4()}`;
      const timestamp = new Date().toISOString();
      const og_img_uri = img.og_uri;
      const img_id = img._id;

      const resp = await get_image_docker(
        ownerId,
        req.params.project,
        "src",
        img.og_img_key
      );
      const url = resp.data.url;

      const img_resp = await axios.get(url, { responseType: "stream" });
      const writer = fs.createWriteStream(og_img_uri);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
        img_resp.data.pipe(writer);
      });

      const img_name_parts = img.new_uri.split("/");
      const img_name = img_name_parts[img_name_parts.length - 1];
      const new_img_uri = `./images/users/${ownerId}/projects/${req.params.project}/preview/${img_name}`;

      const process = {
        user_id: ownerId,        
        runner_id: runnerUserId,  
        project_id: req.params.project,
        img_id: img_id,
        msg_id: msg_id,
        cur_pos: 0,
        og_img_uri: og_img_uri,
        new_img_uri: new_img_uri,
      };

      Process.create(process)
        .then(() => {
          send_msg_tool(
            msg_id,
            timestamp,
            og_img_uri,
            new_img_uri,
            tool_name,
            params
          );
          res.sendStatus(201);
        })
        .catch(() =>
          res.status(603).jsonp(`Error creating preview process request`)
        );
    })
    .catch(() => res.status(501).jsonp(`Error acquiring user's project`));
});

// Add new image to a project
router.post(
  "/:user/:project/img", checkSharePermission, requireEditPermission, requireProjectVersion, upload.single("image"),
  async (req, res) => {
    console.log("PROJECTS-MS /:user/:project/img HIT, file =", !!req.file);
    if (!req.file) {
      res.status(400).jsonp("No file found");
      return;
    }

    Project.getOne(req.params.user, req.params.project)
      .then(async (project) => {
        const same_name_img = project.imgs.filter(
          (i) => path.basename(i.og_uri) == req.file.originalname
        );

        if (same_name_img.length > 0) {
          res
            .status(400)
            .jsonp("This project already has an image with that name.");
          return;
        }

        try {
          const data = new FormData();
          data.append("file", req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
          });
          const resp = await post_image(
            req.params.user,
            req.params.project,
            "src",
            data
          );

          const og_key_tmp = resp.data.data.imageKey.split("/");
          const og_key = og_key_tmp[og_key_tmp.length - 1];

          try {
            const og_uri = `./images/users/${req.params.user}/projects/${req.params.project}/src/${req.file.originalname}`;
            const new_uri = `./images/users/${req.params.user}/projects/${req.params.project}/out/${req.file.originalname}`;

            // Insert new image
            project["imgs"].push({
              og_uri: og_uri,
              new_uri: new_uri,
              og_img_key: og_key,
            });

            const updated = await Project.updateIfVersion(
              req.params.user,
              req.params.project,
              project,
              req.expectedVersion
            );

            if (!updated) {
              const fresh = await Project.getOne(req.params.user, req.params.project);
              return res.status(409).jsonp({
                message: "Project version conflict",
                serverVersion: fresh?.version ?? null,
              });
            }

            res.set("X-Project-Version", String(updated.version));
            return res.sendStatus(204);

          } catch (_) {
            res.status(501).jsonp(`Updating project information`);
          }
        } catch (_) {
          res.status(501).jsonp(`Error storing image`);
        }
      })
      .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
  }
);

// Add new tool to a project
router.post("/:user/:project/tool", checkSharePermission, requireEditPermission, requireProjectVersion, (req, res, next) => {
  // Reject posts to tools that don't fullfil the requirements
  if (!req.body.procedure || !req.body.params) {
    res
      .status(400)
      .jsonp(`A tool should have a procedure and corresponding parameters`);
    return;
  }

  let required_types = ["free", "premium"];

  if (!advanced_tools.includes(req.body.procedure))
    required_types.push("anonymous");

  const callerId = getCallerId(req);

  axios
    .get(users_ms + `${callerId}/type`, { httpsAgent })
    .then((resp) => {
      // Check user type before proceeding
      if (!required_types.includes(resp.data.type)) {
        return res.status(403).jsonp(`User type can't use this tool`);
      }

      // Get project and insert new tool
      Project.getOne(req.params.user, req.params.project)
        .then(async (project) => {
          const tool = { position: project.tools.length, ...req.body };
          project.tools.push(tool);

          const updated = await Project.updateIfVersion(
            req.params.user,
            req.params.project,
            project,
            req.expectedVersion
          );

          if (!updated) {
            const fresh = await Project.getOne(req.params.user, req.params.project);
            return res.status(409).jsonp({
              message: "Project version conflict",
              serverVersion: fresh?.version ?? null,
            });
          }

          res.set("X-Project-Version", String(updated.version));
          return res.sendStatus(204);
        })
        .catch(() => res.status(501).jsonp(`Error acquiring user's project`));
    })
    .catch(() => res.status(401).jsonp(`Error accessing users-ms`));
});

// Reorder tools of a project
router.post(
  "/:user/:project/reorder",
  checkSharePermission,
  requireEditPermission,
  requireProjectVersion,
  (req, res) => {
    Project.getOne(req.params.user, req.params.project)
      .then(async (project) => {
        project.tools = [];

        for (let t of req.body) {
          project.tools.push({
            position: project.tools.length,
            ...t,
          });
        }

        const updated = await Project.updateIfVersion(
          req.params.user,
          req.params.project,
          project,
          req.expectedVersion
        );

        if (!updated) {
          const fresh = await Project.getOne(req.params.user, req.params.project);
          return res.status(409).jsonp({
            message: "Project version conflict",
            serverVersion: fresh?.version ?? null,
          });
        }

        res.set("X-Project-Version", String(updated.version));
        return res.sendStatus(204);
      })
      .catch(() => res.status(501).jsonp(`Error acquiring user's project`));
  }
);

// Process a specific project
router.post("/:user/:project/process", checkSharePermission, requireEditPermission, requireProjectVersion, (req, res) => {
  const ownerId = req.params.user;
  const runnerUserId = getCallerId(req); // <-- agora pode vir do body
  
  console.log("[CALLER]", {
  userParam: req.params.user,
  forwarded: req.headers["x-caller-id"],
  hasAuth: !!req.headers["authorization"],
  caller: getCallerId(req),
});

  Project.getOne(ownerId, req.params.project)
    .then(async (project) => {
      try {
        // apagar resultados anteriores 
        const prev_results = await Result.getAll(ownerId, req.params.project);
        for (let r of prev_results) {
          await delete_image(ownerId, req.params.project, "out", r.img_key);
          await Result.delete(r.user_id, r.project_id, r.img_id);
        }
      } catch (_) {
        res.status(400).jsonp("Error deleting previous results");
        return;
      }

      if (project.tools.length == 0) {
        res.status(400).jsonp("No tools selected");
        return;
      }

      const { adv_ops, totalAdv, charged, newTools } = advanced_tool_num(project);

      console.log(
        "[ADV DEBUG] project:",
        req.params.project,
        "adv_ops:", adv_ops,
        "totalAdv:", totalAdv,
        "charged:", charged,
        "newTools:", newTools,
        "tools:", project.tools.map((t) => t.procedure)
      );

      // função local com a lógica de "arrancar processamento"
      const startProcessing = async () => {
        const source_path = `/../images/users/${ownerId}/projects/${req.params.project}/src`;
        const result_path = `/../images/users/${ownerId}/projects/${req.params.project}/out`;

        if (fs.existsSync(path.join(__dirname, source_path)))
          fs.rmSync(path.join(__dirname, source_path), {
            recursive: true,
            force: true,
          });

        fs.mkdirSync(path.join(__dirname, source_path), { recursive: true });

        if (fs.existsSync(path.join(__dirname, result_path)))
          fs.rmSync(path.join(__dirname, result_path), {
            recursive: true,
            force: true,
          });

        fs.mkdirSync(path.join(__dirname, result_path), { recursive: true });

        let error = false;

        for (let img of project.imgs) {
          let url = "";
          try {
            const resp = await get_image_docker(
              ownerId,
              req.params.project,
              "src",
              img.og_img_key
            );
            url = resp.data.url;

            const img_resp = await axios.get(url, { responseType: "stream" });
            const writer = fs.createWriteStream(img.og_uri);

            await new Promise((resolve, reject) => {
              writer.on("finish", resolve);
              writer.on("error", reject);
              img_resp.data.pipe(writer);
            });
          } catch (_) {
            res.status(400).jsonp("Error acquiring source images");
            return;
          }

          const msg_id = `request-${uuidv4()}`;
          const timestamp = new Date().toISOString();

          const og_img_uri = img.og_uri;
          const new_img_uri = img.new_uri;
          const tool = project.tools.filter((t) => t.position === 0)[0];

          const tool_name = tool.procedure;
          const params = tool.params;

          const process = {
            user_id: ownerId,
            runner_id: runnerUserId,
            project_id: req.params.project,
            img_id: img._id,
            msg_id: msg_id,
            cur_pos: 0,
            og_img_uri: og_img_uri,
            new_img_uri: new_img_uri,
          };

          await Process.create(process)
            .then(() => {
              send_msg_tool(
                msg_id,
                timestamp,
                og_img_uri,
                new_img_uri,
                tool_name,
                params
              );
            })
            .catch(() => (error = true));
        }

        if (error) {
          res
            .status(603)
            .jsonp(
              `There were some erros creating all process requests. Some results can be invalid.`
            );
        } else {
          res.sendStatus(201);
        }
      };

      // Caso 1: sem advanced tools -> não é preciso falar com users-ms
      if (adv_ops === 0) {
        try {
          // Se tivermos “chargedAdvancedTools” maior que o total atual, 
          // corrigimos e guardamos.
          if (charged !== project.chargedAdvancedTools) {
            project.chargedAdvancedTools = charged;
            project.pendingAdvancedOps = 0;

            const updated = await Project.updateIfVersion(
              ownerId,
              req.params.project,
              project,
              req.expectedVersion
          );

          if (!updated) {
              const fresh = await Project.getOne(ownerId, req.params.project);
              return res.status(409).jsonp({
                message: "Project version conflict",
                serverVersion: fresh?.version ?? null,
              });
            }
          res.set("X-Project-Version", String(updated.version));

          }

          await startProcessing();
          
        } catch (e) {
          console.error("Error starting processing (no advanced tools):", e);
          res.status(500).jsonp("Error processing project");
        }
        return;
      }

      // Caso 2: com advanced tools -> verificar quota no users-ms
      const callerId = getCallerId(req);
      axios
        .get(users_ms + `${callerId}/process/${adv_ops}`, { httpsAgent: httpsAgent })
        .then(async (resp) => {
          const can_process = resp.data;

          if (!can_process) {
            res.status(404).jsonp("No more daily_operations available");
            return;
          }

          try {
            // Marcamos que já pagámos todas as tools avançadas atuais
            // (charged + newTools === totalAdv)
            project.chargedAdvancedTools = charged + newTools;
            project.pendingAdvancedOps = adv_ops;

            const updated = await Project.updateIfVersion(
              ownerId,
              req.params.project,
              project,
              req.expectedVersion
            );

            if (!updated) {
              const fresh = await Project.getOne(ownerId, req.params.project);
              return res.status(409).jsonp({
                message: "Project version conflict",
                serverVersion: fresh?.version ?? null,
              });
            }

            res.set("X-Project-Version", String(updated.version));

            await startProcessing();
          } catch (e) {
            console.error("Error starting processing (advanced tools):", e);
            res.status(500).jsonp("Error processing project");
          }
        })
        .catch((err) => {
          console.error("Error calling users-ms /process:", {
            message: err.message,
            status: err.response?.status,
            data: err.response?.data,
            url: users_ms + `${callerId}/process/${adv_ops}`,
            callerId,
            adv_ops,
          });

          if (err.response) {
            const status = err.response.status || 500;
            const data = err.response.data || "Error checking if can process";
            return res.status(status).jsonp(data);
          }

          return res.status(500).jsonp("Error checking if can process");
        });
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Update a specific project
router.put(
  "/:user/:project",
  checkSharePermission,
  requireEditPermission,
  requireProjectVersion,
  (req, res) => {
    Project.getOne(req.params.user, req.params.project)
      .then(async (project) => {
        project.name = req.body.name || project.name;

        const updated = await Project.updateIfVersion(
          req.params.user,
          req.params.project,
          project,
          req.expectedVersion
        );

        if (!updated) {
          const fresh = await Project.getOne(req.params.user, req.params.project);
          return res.status(409).jsonp({
            message: "Project version conflict",
            serverVersion: fresh?.version ?? null,
          });
        }

        res.set("X-Project-Version", String(updated.version));
        return res.sendStatus(204);
      })
      .catch(() => res.status(501).jsonp(`Error acquiring user's project`));
  }
);

// Update a tool from a specific project
router.put(
  "/:user/:project/tool/:tool",
  checkSharePermission,
  requireEditPermission,
  requireProjectVersion,
  (req, res) => {
    Project.getOne(req.params.user, req.params.project)
      .then(async (project) => {
        try {
          const tool_pos = project.tools.findIndex((i) => i._id == req.params.tool);
          const prev_tool = project.tools[tool_pos];

          project.tools[tool_pos] = {
            position: prev_tool.position,
            procedure: prev_tool.procedure,
            params: req.body.params,
            _id: prev_tool._id,
          };

          const updated = await Project.updateIfVersion(
            req.params.user,
            req.params.project,
            project,
            req.expectedVersion
          );

          if (!updated) {
            const fresh = await Project.getOne(req.params.user, req.params.project);
            return res.status(409).jsonp({
              message: "Project version conflict",
              serverVersion: fresh?.version ?? null,
            });
          }

          res.set("X-Project-Version", String(updated.version));
          return res.sendStatus(204);
        } catch (_) {
          return res.status(599).jsonp(`Error updating tool. Make sure such tool exists`);
        }
      })
      .catch(() => res.status(501).jsonp(`Error acquiring user's project`));
  }
);

// Delete a project
router.delete( "/:user/:project", checkSharePermission, requireEditPermission, requireProjectVersion, async (req, res) => {

    const ok = await Project.deleteIfVersion(req.params.user, req.params.project, req.expectedVersion);
    if (!ok) {
      const fresh = await Project.getOne(req.params.user, req.params.project);
      return res.status(409).jsonp({ message: "Project version conflict", serverVersion: fresh?.version ?? null });
    }
    return res.sendStatus(204);
  }
);


// Delete ALL projects from a user (used when deleting an account)
router.delete("/:user", async (req, res, next) => {
  const userId = req.params.user;

  try {
    const projects = await Project.getAll(userId);

    for (const p of projects) {
      await deleteProjectAndResources(userId, p._id);
    }

    return res.sendStatus(204);
  } catch (err) {
    console.error("Error deleting all projects from user:", err);
    return res.status(504).jsonp(`Error deleting user's projects`);
  }
});


// Delete an image from a project
router.delete("/:user/:project/img/:img", checkSharePermission, requireEditPermission, requireProjectVersion, (req, res, next) => {
  // Get project and delete specified image
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      try {
        const img = project["imgs"].filter((i) => i._id == req.params.img)[0];

        await delete_image(
          req.params.user,
          req.params.project,
          "src",
          img.og_img_key
        );
        project["imgs"].remove(img);

        const results = await Result.getOne(
          req.params.user,
          req.params.project,
          img._id
        );

        const previews = await Preview.getOne(
          req.params.user,
          req.params.project,
          img._id
        );

        if (results !== null && results !== undefined) {
          await delete_image(
            req.params.user,
            req.params.project,
            "out",
            results.img_key
          );
          await Result.delete(
            results.user_id,
            results.project_id,
            results.img_id
          );
        }

        if (previews !== null && previews !== undefined) {
          await delete_image(
            req.params.user,
            req.params.project,
            "preview",
            previews.img_key
          );
          await Preview.delete(
            previews.user_id,
            previews.project_id,
            previews.img_id
          );
        }

        const updated = await Project.updateIfVersion(
          req.params.user,
          req.params.project,
          project,
          req.expectedVersion
        );

        if (!updated) {
          const fresh = await Project.getOne(req.params.user, req.params.project);
          return res.status(409).jsonp({
            message: "Project version conflict",
            serverVersion: fresh?.version ?? null,
          });
        }

        res.set("X-Project-Version", String(updated.version));
        return res.sendStatus(204);

      } catch (_) {
        res.status(400).jsonp(`Error deleting image information.`);
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Delete a tool from a project
router.delete(
  "/:user/:project/tool/:tool",
  checkSharePermission,
  requireEditPermission,
  requireProjectVersion,
  (req, res) => {
    Project.getOne(req.params.user, req.params.project)
      .then(async (project) => {
        try {
          const tool = project.tools.find((i) => i._id == req.params.tool);
          project.tools.remove(tool);

          for (let i = 0; i < project.tools.length; i++) {
            if (project.tools[i].position > tool.position) project.tools[i].position--;
          }

          const updated = await Project.updateIfVersion(
            req.params.user,
            req.params.project,
            project,
            req.expectedVersion
          );

          if (!updated) {
            const fresh = await Project.getOne(req.params.user, req.params.project);
            return res.status(409).jsonp({
              message: "Project version conflict",
              serverVersion: fresh?.version ?? null,
            });
          }

          res.set("X-Project-Version", String(updated.version));
          return res.sendStatus(204);
        } catch (_) {
          return res.status(400).jsonp(`Error deleting tool's information`);
        }
      })
      .catch(() => res.status(501).jsonp(`Error acquiring user's project`));
  }
);

// Cancelar processamento de um projeto 
router.delete("/:user/:project/process", checkSharePermission, requireEditPermission, requireProjectVersion, async (req, res) => {
  try {
    // 1) tentar devolver operações ao utilizador (apenas as pendentes desta execução)
    try {
      const project = await Project.getOne(req.params.user, req.params.project);
      const adv_ops = project.pendingAdvancedOps || 0;

      const callerId = getCallerId(req);

      if (adv_ops > 0) {
        await axios.post(
          users_ms + `${callerId}/process/refund/${adv_ops}`,
          {},
          { httpsAgent: httpsAgent },
        );

        // reset do pendingAdvancedOps depois do refund
        project.pendingAdvancedOps = 0;
        const updated = await Project.updateIfVersion(
          req.params.user,
          req.params.project,
          project,
          req.expectedVersion
        );

        if (!updated) {
          const fresh = await Project.getOne(req.params.user, req.params.project);
          return res.status(409).jsonp({
            message: "Project version conflict",
            serverVersion: fresh?.version ?? null,
          });
        }

        res.set("X-Project-Version", String(updated.version));

      }
    } catch (err) {
      console.error("Error refunding operations on cancel:", err);
    }

    // 2) apagar processos em curso
    const processes = await Process.getProject(
      req.params.user,
      req.params.project,
    );

    if (processes && processes.length > 0) {
      for (const p of processes) {
        await Process.delete(p.user_id, p.project_id, p._id);
      }
    }

    // 3) limpar diretórios temporários locais (não mexe no MinIO)
    const basePath = `/../images/users/${req.params.user}/projects/${req.params.project}`;
    const tmpDirs = ["src", "out", "preview"];

    for (const dir of tmpDirs) {
      const full = path.join(__dirname, `${basePath}/${dir}`);
      if (fs.existsSync(full)) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }

    return res.sendStatus(204);
  } catch (err) {
    console.error("Error cancelling project processing:", err);
    return res.status(500).jsonp("Error cancelling project processing");
  }
});

// ================== AI ASSISTANT (SUGGEST) ==================

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function buildSuggestions(message, currentTools) {
  const txt = normalizeText(message);

  // helpers
  const has = (...words) => words.some((w) => txt.includes(normalizeText(w)));

  // recipes (tools + params) — usa só procedures que já existem 
  const S = [];

  // 1) Preto & Branco
  if (has("preto", "branco", "pb", "p&b", "black and white", "monocrom")) {
    S.push({
      name: "Preto & Branco",
      description: "Remove cor e aumenta contraste para um look clássico.",
      tools: [
        { procedure: "saturation", params: { saturationFactor: 0 } },
        { procedure: "contrast", params: { contrastFactor: 1.25 } },
        { procedure: "brightness", params: { brightness: 1.05 } },
      ],
    });
  }

  // 2) Vintage
  if (has("vintage", "retro", "filme", "analog", "nostalg")) {
    S.push({
      name: "Vintage Suave",
      description: "Contraste suave, tons mais quentes e leve dessaturação.",
      tools: [
        { procedure: "contrast", params: { contrastFactor: 1.12 } },
        { procedure: "saturation", params: { saturationFactor: 0.88 } },
        { procedure: "brightness", params: { brightness: 1.06 } },
      ],
    });
  }

  // 3) Pop / Mais cor
  if (has("pop", "mais cor", "vibrante", "satur", "vivo")) {
    S.push({
      name: "Pop (Mais cor)",
      description: "Aumenta saturação e contraste para cores mais vivas.",
      tools: [
        { procedure: "saturation", params: { saturationFactor: 1.45 } },
        { procedure: "contrast", params: { contrastFactor: 1.18 } },
        { procedure: "brightness", params: { brightness: 1.02 } },
      ],
    });
  }

  // 4) Mais claro / Mais escuro
  if (has("mais claro", "clarear", "brilho", "mais luz")) {
    S.push({
      name: "Iluminar",
      description: "Aumenta o brilho de forma moderada.",
      tools: [{ procedure: "brightness", params: { brightness: 1.18 } }],
    });
  }
  if (has("mais escuro", "escurecer", "menos luz")) {
    S.push({
      name: "Escurecer",
      description: "Reduz o brilho de forma moderada.",
      tools: [{ procedure: "brightness", params: { brightness: 0.88 } }],
    });
  }

  // fallback: se não apanhou keywords, devolve sugestões gerais
  if (S.length === 0) {
    S.push(
      {
        name: "Contraste Suave",
        description: "Leve aumento de contraste para dar mais definição.",
        tools: [{ procedure: "contrast", params: { contrastFactor: 1.12 } }],
      },
      {
        name: "Realce de cor",
        description: "Aumenta ligeiramente a saturação.",
        tools: [{ procedure: "saturation", params: { saturationFactor: 1.18 } }],
      },
      {
        name: "Luz & Cor",
        description: "Equilíbrio simples entre brilho, contraste e cor.",
        tools: [
          { procedure: "brightness", params: { brightness: 1.06 } },
          { procedure: "contrast", params: { contrastFactor: 1.10 } },
          { procedure: "saturation", params: { saturationFactor: 1.10 } },
        ],
      },
    );
  }

  // RNF66 “≥2 tools” só é requisito para criar preset;
  // aqui o assistente pode sugerir 1 tool (mas podemos forçar >=2 ao por padding).
  // Vou padronizar para >=2 para ficar alinhado com a filosofia de "recipe".
  for (const sug of S) {
    if (Array.isArray(sug.tools) && sug.tools.length === 1) {
      // adiciona uma tool neutra/leve para cumprir "recipe >= 2"
      sug.tools.push({ procedure: "contrast", params: { contrastFactor: 1.05 } });
    }
  }

  // evita devolver uma sugestão “igual ao que já está”
  // (muito básico: compara JSON string)
  const currentStr = JSON.stringify(currentTools || []);
  return S.filter((s) => JSON.stringify(s.tools) !== currentStr).slice(0, 5);
}

router.post(
  "/:user/:project/assistant/suggest",
  checkSharePermission,
  requireEditPermission,
  requireProjectVersion,
  async (req, res) => {
    try {
      const ownerId = req.params.user;

      const { message, currentTools } = req.body || {};
      if (!message || String(message).trim().length < 2) {
        return res.status(400).jsonp("Message is required");
      }

      // podes usar project.tools como fonte de verdade se quiseres
      // const project = await Project.getOne(ownerId, req.params.project);

      const suggestions = buildSuggestions(message, currentTools);

      return res.status(200).jsonp({
        suggestions,
      });
    } catch (err) {
      console.error("assistant/suggest error:", err);
      return res.status(500).jsonp("Error generating suggestions");
    }
  },
);

// ================== FIM AI ASSISTANT ==================

module.exports = { router, process_msg };