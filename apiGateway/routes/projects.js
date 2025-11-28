var express = require("express");
var router = express.Router();

const axios = require("axios");

const https = require("https");
const fs = require("fs");

const multer = require("multer");
const FormData = require("form-data");

const auth = require("../auth/auth");

const key = fs.readFileSync(__dirname + "/../certs/selfsigned.key");
const cert = fs.readFileSync(__dirname + "/../certs/selfsigned.crt");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // (NOTE: this will disable client verification)
  cert: cert,
  key: key,
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const projectsURL = "https://projects:9001/";

// TODO Verify jwt

/*
Project structure
{
    "_id": Mongoose.type.id,
    "user_id": Mongoose.type.id,
    "name": String,
    "imgs": [Image Structure],
    "tools": [Tool Structure],
}

Image structure
{
    "_id": Mongoose.type.id,
    "og_uri": String,
    "new_uri": String
}

Tool structure
{
    "_id": Mongoose.type._id,
    "position": Number,
    "procedure": String,
    "params": Object
}

Post answer structure in case of success
{
    "acknowledged": Bool,
    "modifiedCount": Number,
    "upsertedId": null,
    "upsertedCount": Number,
    "matchedCount": Number
}
*/

/**
 * Note: auth.checkToken is a midleware used to verify JWT
 */

// listar links de um projeto (só dono) – protegido
router.get("/:user/:project/share", auth.checkToken, (req, res) => {
  axios
    .get(projectsURL + `${req.params.user}/${req.params.project}/share`, {
      httpsAgent,
      headers: { Authorization: req.headers["authorization"] },
    })
    .then((resp) => res.status(200).jsonp(resp.data))
    .catch((err) => {
      console.error("Error listing share links:", err.response?.data);
      res.status(500).jsonp("Error listing share links");
    });
});

// criar link de partilha
router.post("/:user/:project/share", auth.checkToken, (req, res) => {
  axios
    .post(
      projectsURL + `${req.params.user}/${req.params.project}/share`,
      req.body,
      {
        httpsAgent,
        headers: { Authorization: req.headers["authorization"] },
      },
    )
    .then((resp) => res.status(201).jsonp(resp.data))
    .catch((err) => {
      console.error("Error creating share link:", err.response?.data);
      res.status(500).jsonp("Error creating share link");
    });
});

// resolver link de partilha (público – sem auth)
router.get("/share/:shareId", (req, res) => {
  axios
    .get(projectsURL + `share/${req.params.shareId}`, { httpsAgent })
    .then((resp) => res.status(200).jsonp(resp.data))
    .catch((err) => {
      const status = err.response?.status || 500;
      const msg =
        err.response?.data ||
        (status === 404
          ? "Share link not found"
          : status === 410
            ? "Share link revoked"
            : "Error resolving share link");

      res.status(status).jsonp(msg);
    });
});

// revogar link de partilha (dono, protegido)
router.delete("/:user/share/:shareId", auth.checkToken, (req, res) => {
  axios
    .delete(projectsURL + `${req.params.user}/share/${req.params.shareId}`, {
      httpsAgent,
      headers: { Authorization: req.headers["authorization"] },
    })
    .then(() => res.sendStatus(204))
    .catch((err) => {
      console.error("Error revoking share link:", err.response?.data);
      const status = err.response?.status || 500;
      res.status(status).jsonp("Error revoking share link");
    });
});

// obter projeto completo via shareId (público, sem auth)
router.get("/share/:shareId/project", (req, res) => {
  axios
    .get(projectsURL + `share/${req.params.shareId}/project`, {
      httpsAgent,
    })
    .then((resp) => res.status(200).jsonp(resp.data))
    .catch((err) => {
      console.error("Error getting shared project:", err.response?.data || err);
      const status = err.response?.status || 500;
      const msg = err.response?.data || "Error getting shared project";
      res.status(status).jsonp(msg);
    });
});

/**
 * Get user's projects
 * @body Empty
 * @returns List of projects, each project has no information about it's images or tools
 */
router.get("/:user", auth.checkToken, function (req, res, next) {
  axios
    .get(projectsURL + `${req.params.user}`, { httpsAgent: httpsAgent })
    .then((resp) => res.status(200).jsonp(resp.data))
    .catch((err) => res.status(500).jsonp("Error getting users"));
});

/**
 * Get user's project
 * @body Empty
 * @returns The required project
 */
router.get("/:user/:project", auth.checkToken, function (req, res, next) {
  const ownerId = req.query.owner || req.params.user;
  axios
    .get(projectsURL + `${ownerId}/${req.params.project}`, {
      httpsAgent: httpsAgent,
    })
    .then((resp) => res.status(200).jsonp(resp.data))
    .catch((err) => res.status(500).jsonp("Error getting project"));
});

/**
 * Get project image
 * @body Empty
 * @returns The image url
 */
router.get(
  "/:user/:project/img/:img",
  auth.checkToken,
  function (req, res, next) {
    const ownerId = req.query.owner || req.params.user;
    axios
      .get(
        projectsURL +
          `${ownerId}/${req.params.project}/img/${req.params.img}`,
        {
          httpsAgent: httpsAgent,
        }
      )
      .then((resp) => {
        res.status(200).send(resp.data);
      })
      .catch((err) => res.status(500).jsonp("Error getting project image"));
  }
);

/**
 * Get project images
 * @body Empty
 * @returns The project's images
 */
router.get("/:user/:project/imgs", auth.checkToken, function (req, res, next) {
  const ownerId = req.query.owner || req.params.user;
  axios
    .get(projectsURL + `${ownerId}/${req.params.project}/imgs`, {
      httpsAgent: httpsAgent,
    })
    .then((resp) => {
      res.status(200).send(resp.data);
    })
    .catch((err) => res.status(500).jsonp("Error getting project images"));
});

/**
 * Get project's processment result
 * @body Empty
 * @returns The required results, sent as a zip
 */
router.get(
  "/:user/:project/process",
  auth.checkToken,
  function (req, res, next) {
    const ownerId = req.query.owner || req.params.user;
    axios
      .get(projectsURL + `${ownerId}/${req.params.project}/process`, {
        httpsAgent: httpsAgent,
        responseType: "arraybuffer",
      })
      .then((resp) => res.status(200).send(resp.data))
      .catch((err) =>
        res.status(500).jsonp("Error getting processing results file")
      );
  }
);

  // Cancelar processamento de um projeto
  router.delete("/:user/:project/process", auth.checkToken, function (req, res, next) {
    const callerId = req.params.user;    // quem está autenticado (runner)
    const ownerId = req.query.owner || req.params.user;
    axios
      .delete(
        projectsURL + `${ownerId}/${req.params.project}/process`, 
        { 
          httpsAgent: httpsAgent,
          data: { runnerUserId: callerId },
         }
      )
      .then((resp) => res.sendStatus(resp.status))
      .catch((err) =>
        res.status(500).jsonp("Error cancelling project processing")
      );
  });


/**
 * Get project's processment result
 * @body Empty
 * @returns The required results, sent as [{img_id, img_name, url}]
 */
router.get(
  "/:user/:project/process/url",
  auth.checkToken,
  function (req, res, next) {
    const ownerId = req.query.owner || req.params.user;
    axios
      .get(
        projectsURL + `${ownerId}/${req.params.project}/process/url`,
        {
          httpsAgent: httpsAgent,
        }
      )
      .then((resp) => {
        res.status(200).send(resp.data);
      })
      .catch((err) =>
        res.status(500).jsonp("Error getting processing results")
      );
  }
);

/**
 * Create new user's project
 * @body { "name": String }
 * @returns Created project's data
 */
router.post("/:user", auth.checkToken, function (req, res, next) {
  axios
    .post(projectsURL + `${req.params.user}`, req.body, {
      httpsAgent: httpsAgent,
    })
    .then((resp) => res.status(201).jsonp(resp.data))
    .catch((err) => res.status(500).jsonp("Error creating new project"));
});

/**
 * Preview an image
 * @body Empty
 * @returns String indication preview is being processed
 */
router.post(
  "/:user/:project/preview/:img",
  auth.checkToken,
  function (req, res, next) {
    const callerId = req.params.user;                 // quem está autenticado (runner)
    const ownerId = req.query.owner || callerId;      // dono do projeto

    const body = {
      ...req.body,
      runnerUserId: callerId,                         
    };

    axios
      .post(
        projectsURL +
          `${ownerId}/${req.params.project}/preview/${req.params.img}`,
        body,
        { httpsAgent: httpsAgent }
      )
      .then((resp) => res.status(201).jsonp(resp.data))
      .catch((err) => {
        console.log(err);
        res.status(500).jsonp("Error requesting image preview");
      });
  }
);

/**
 * Add image to project
 * @body Empty
 * @file Image to be added
 * @returns Post answer structure in case of success
 */
router.post(
  "/:user/:project/img",
  upload.single("image"),
  auth.checkToken,
  function (req, res, next) {
    const ownerId = req.query.owner || req.params.user;
    const data = new FormData();
    data.append("image", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    axios
      .post(
        projectsURL + `${ownerId}/${req.params.project}/img`,
        data,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          httpsAgent: httpsAgent,
        }
      )
      .then((resp) => res.sendStatus(201))
      .catch((err) => res.status(500).jsonp("Error adding image to project"));
  }
);

/**
 * Add tool to project
 * @body { "procedure": String, "params": Object }
 * @returns Post answer structure in case of success
 */
router.post("/:user/:project/tool", auth.checkToken, function (req, res, next) {
  const ownerId = req.query.owner || req.params.user;
  axios
    .post(
      projectsURL + `${ownerId}/${req.params.project}/tool`,
      req.body,
      { httpsAgent: httpsAgent }
    )
    .then((resp) => res.status(201).jsonp(resp.data))
    .catch((err) => res.status(500).jsonp("Error adding tool to project"));
});

/**
 * Reorder tools of a project
 * @body [{ "position": Number, "procedure": String, "params": Object }] (Position is a unique number between 0 and req.body.length - 1)
 * @returns Post answer structure in case of success
 */
router.post(
  "/:user/:project/reorder",
  auth.checkToken,
  function (req, res, next) {
    const ownerId = req.query.owner || req.params.user;
    axios
      .post(
        projectsURL + `${ownerId}/${req.params.project}/reorder`,
        req.body,
        { httpsAgent: httpsAgent }
      )
      .then((resp) => res.status(201).jsonp(resp.data))
      .catch((err) => res.status(500).jsonp("Error reordering tools"));
  }
);

/**
 * Generate request to process a project
 * @body Empty
 * @returns String indicating process request has been created
 */
router.post(
  "/:user/:project/process",
  auth.checkToken,
  function (req, res, next) {
    const callerId = req.params.user;                 // quem está autenticado (runner)
    const ownerId = req.query.owner || callerId;      // dono do projeto (owner)

    const body = {
      ...req.body,
      runnerUserId: callerId,                         
    };

    axios
      .post(
        projectsURL + `${ownerId}/${req.params.project}/process`,
        body,
        { httpsAgent: httpsAgent }
      )
      .then((resp) => res.status(201).jsonp(resp.data))
      .catch((err) => {
        if (err.response) {
          return res
            .status(err.response.status)
            .jsonp(err.response.data);
        }

        console.error("Error requesting project processing:", err.message);
        return res.status(500).jsonp("Error requesting project processing");
      });
  }
);

/**
 * Update a specific project
 * @body { "name": String }
 * @returns Empty
 */
router.put("/:user/:project", auth.checkToken, function (req, res, next) {
  const ownerId = req.query.owner || req.params.user;
  axios
    .put(projectsURL + `${ownerId}/${req.params.project}`, req.body, {
      httpsAgent: httpsAgent,
    })
    .then((_) => res.sendStatus(204))
    .catch((err) => res.status(500).jsonp("Error updating project details"));
});

/**
 * Update a tool from a project
 * @body { "params" : Object }
 * @returns Empty
 */
router.put(
  "/:user/:project/tool/:tool",
  auth.checkToken,
  function (req, res, next) {
    const ownerId = req.query.owner || req.params.user;
    axios
      .put(
        projectsURL +
          `${ownerId}/${req.params.project}/tool/${req.params.tool}`,
        req.body,
        { httpsAgent: httpsAgent }
      )
      .then((_) => res.sendStatus(204))
      .catch((err) => res.status(500).jsonp("Error updating tool params"));
  }
);

/**
 * Delete a user's project
 * @body Empty
 * @returns Empty
 */
router.delete("/:user/:project", auth.checkToken, function (req, res, next) {
  const ownerId = req.query.owner || req.params.user;
  axios
    .delete(projectsURL + `${ownerId}/${req.params.project}`, {
      httpsAgent: httpsAgent,
    })
    .then((_) => res.sendStatus(204))
    .catch((err) => res.status(500).jsonp("Error deleting project"));
});

/**
 * Remove an image from a user's project
 * @body Empty
 * @returns Empty
 */
router.delete(
  "/:user/:project/img/:img",
  auth.checkToken,
  function (req, res, next) {
    const ownerId = req.query.owner || req.params.user;
    axios
      .delete(
        projectsURL +
          `${ownerId}/${req.params.project}/img/${req.params.img}`,
        { httpsAgent: httpsAgent }
      )
      .then((_) => res.sendStatus(204))
      .catch((err) =>
        res.status(500).jsonp("Error deleting image from project")
      );
  }
);

/**
 * Remove a tool from a user's project
 * @body Empty
 * @returns Empty
 */
router.delete(
  "/:user/:project/tool/:tool",
  auth.checkToken,
  function (req, res, next) {
    const ownerId = req.query.owner || req.params.user;
    axios
      .delete(
        projectsURL +
          `${ownerId}/${req.params.project}/tool/${req.params.tool}`,
        { httpsAgent: httpsAgent }
      )
      .then((_) => res.sendStatus(204))
      .catch((err) =>
        res.status(500).jsonp("Error removing tool from project")
      );
  }
);

module.exports = router;
