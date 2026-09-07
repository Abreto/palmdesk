async function initializeDatabase({ sequelize, connectMysql, liveConfig }) {
  await connectMysql();
  // CREATE missing tables only. Existing tables and their contents are preserved.
  await sequelize.sync();
  for (const key of ['frontend_live_home_bg', 'frontend_wechat_qrcode']) {
    await liveConfig.findOrCreate({
      where: { key },
      defaults: { key, value: '', desc: key, type: 'upload' },
      paranoid: false,
    });
  }
}

module.exports = { initializeDatabase };
