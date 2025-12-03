// projects/middleware/shareAuth.js
const Project = require("../controllers/project");

async function checkSharePermission(req, res, next) {
  const shareId = req.query.share;

  if (!shareId) return next(); // dono, segue

  const project = await Project.getOneByShareId(shareId);
  if (!project) {
    return res.status(404).jsonp("Share link not found");
  }

  const link = (project.sharedLinks || []).find(l => l.id === shareId);
  if (!link) {
    return res.status(410).jsonp("Share link not found");
  }

  if (link.revoked) {
    return res.status(410).jsonp("Share link revoked");
  }

  // Garantir que o path bate certo com o projeto do share
  if (req.params.user && String(req.params.user) !== String(project.user_id)) {
    return res.status(403).jsonp("Share link does not match this project owner");
  }
  if (req.params.project && String(req.params.project) !== String(project._id)) {
    return res.status(403).jsonp("Share link does not match this project");
  }

  req.sharedProject = project;
  req.sharedPermission = link.permission;
  next();
}

function requireEditPermission(req, res, next) {

  console.log("EDIT PERMISSION DEBUG", {
    ownerId: req.params.user,
    sharedPermission: req.sharedPermission,
    queryShare: req.query.share,
    headersAuth: req.headers.authorization
  });

  // Caso A — dono autenticado, bypass total
  if (!req.sharedPermission) {
        return next();
  }

  // Caso B — acesso via share
  if (req.sharedPermission === "edit") return next();

  return res.status(403).jsonp("Share link has no edit permission");
}

module.exports = { checkSharePermission, requireEditPermission };