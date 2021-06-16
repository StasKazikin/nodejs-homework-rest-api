const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const { promisify } = require('util');
require('dotenv').config();
const Users = require('../model/users');
const { HttpCode } = require('../helpers/constants');
const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY;

// const UploadAvatar = require('../services/upload-avatars-local')
const UploadAvatar = require('../services/upload-avatars-cloud');

const EmailService = require('../services/email');
const {
  CreateSenderSendgrid,
  CreateSenderNodemailer,
} = require('../services/sender-email');

// const AVATARS_OF_USERS = process.env.AVATARS_OF_USERS

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

const signup = async (req, res, next) => {
  try {
    const user = await Users.findByEmail(req.body.email);
    if (user) {
      return res.status(HttpCode.CONFLICT).json({
        status: '409 Conflict',
        code: HttpCode.CONFLICT,
        message: 'Email is in use',
      });
    }
    const newUser = await Users.createUser(req.body);
    const { id, email, subscription, avatarURL, verifyToken } = newUser;
    try {
      const emailService = new EmailService(
        process.env.NODE_ENV,
        new CreateSenderSendgrid(),
      );
      await emailService.sendVerifyPasswordEmail(verifyToken, email);
    } catch (e) {
      console.log(e.message);
    }

    return res.status(HttpCode.CREATED).json({
      status: '201 Created',
      code: HttpCode.CREATED,
      data: {
        id,
        email,
        subscription,
        avatarURL,
      },
    });
  } catch (e) {
    next(e);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await Users.findByEmail(email);
    const isValidPassword = await user?.validPassword(password);

    if (!user || !isValidPassword || !user.verify) {
      return res.status(HttpCode.UNAUTHORIZED).json({
        status: '401 Unauthorized',
        code: HttpCode.UNAUTHORIZED,
        message: 'Email or password is wrong',
      });
    }

    const payload = { id: user.id };
    const token = jwt.sign(payload, JWT_SECRET_KEY, { expiresIn: '2h' });
    await Users.updateToken(user.id, token);
    return res.status(HttpCode.OK).json({
      status: '200 OK',
      code: HttpCode.OK,
      data: {
        token,
      },
    });
  } catch (e) {
    next(e);
  }
};

const logout = async (req, res, next) => {
  try {
    await Users.updateToken(req.user.id, null);
    return res.status(HttpCode.NO_CONTENT).json({});
  } catch (e) {
    next(e);
  }
};

const current = async (req, res, next) => {
  try {
    const currentUser = await Users.findByToken(req.user.token);
    const { email, subscription, avatarURL } = currentUser;
    return res.status(HttpCode.OK).json({
      status: '200 OK',
      code: HttpCode.OK,
      data: { email, subscription, avatarURL },
    });
  } catch (e) {
    next(e);
  }
};

const avatars = async (req, res, next) => {
  try {
    const id = req.user.id;
    // const uploads = new UploadAvatar(AVATARS_OF_USERS)
    // const avatarUrl = await uploads.saveAvatarToStatic({
    //   idUser: id,
    //   pathFile: req.file.path,
    //   name: req.file.filename,
    //   oldFile: req.user.avatar,
    // })
    const uploadCloud = promisify(cloudinary.uploader.upload);
    const uploads = new UploadAvatar(uploadCloud);
    const { userIdImg, avatarUrl } = await uploads.saveAvatarToCloud(
      req.file.path,
      req.user.userIdImg,
    );
    await Users.updateAvatar(id, avatarUrl, userIdImg);

    return res.status(HttpCode.OK).json({
      status: '200 OK',
      code: HttpCode.OK,
      data: { avatarUrl },
    });
  } catch (e) {
    next(e);
  }
};

const verify = async (req, res, next) => {
  try {
    const user = await Users.getUserByVerifyToken(req.params.token);
    if (user) {
      await Users.updateVerifyToken(user.id, true, null);
      return res.status(HttpCode.OK).json({
        status: '200 OK',
        code: HttpCode.OK,
        message: 'Verification successful',
      });
    }
    return res.status(HttpCode.NOT_FOUND).json({
      status: '404 Not Found',
      code: HttpCode.NOT_FOUND,
      message: 'User not found',
    });
  } catch (error) {
    next(error);
  }
};

const repeatSendEmailVerify = async (req, res, next) => {
  const user = await Users.findByEmail(req.body.email);
  if (user) {
    const { name, email, verifyToken, verify } = user;
    console.log(
      '🚀 ~ file: users.js ~ line 146 ~ repeatSendEmailVerify ~ user',
      user,
    );

    if (!email) {
      return res.status(HttpCode.BAD_REQUEST).json({
        status: 'HttpCode.BAD_REQUEST',
        code: HttpCode.BAD_REQUEST,
        message: 'Missing required field email',
      });
    }

    if (!verify) {
      try {
        const emailService = new EmailService(
          process.env.NODE_ENV,
          new CreateSenderNodemailer(),
        );
        await emailService.sendVerifyPasswordEmail(verifyToken, email, name);
        return res.status(HttpCode.OK).json({
          status: '200 OK',
          code: HttpCode.OK,
          message: 'Verification email sent',
        });
      } catch (e) {
        console.log(e.message);
        return next(e);
      }
    }
    return res.status(HttpCode.BAD_REQUEST).json({
      status: '400 Bad Request',
      code: HttpCode.BAD_REQUEST,
      message: 'Verification has already been passed',
    });
  }
  return res.status(HttpCode.NOT_FOUND).json({
    status: 'error',
    code: HttpCode.NOT_FOUND,
    message: 'User not found',
  });
};

module.exports = {
  signup,
  login,
  logout,
  current,
  avatars,
  verify,
  repeatSendEmailVerify,
};
