'use strict';

// Пример подключения к Express. Реальные repository/decrypt берутся из проекта Елисей.
function installWbCabinetTokenResolver(app, { cabinetsRepository, decrypt }) {
  app.locals.resolveWbCabinetToken = async ({ userId, cabinetId }) => {
    if (!userId || !cabinetId) return null;

    const cabinet = await cabinetsRepository.findOne({
      id: cabinetId,
      userId,
      marketplace: 'wildberries',
      isActive: true,
    });

    if (!cabinet?.encryptedApiToken) return null;

    return {
      token: await decrypt(cabinet.encryptedApiToken),
      userId: cabinet.userId,
      cabinetId: cabinet.id,
      cabinetName: cabinet.name || 'Кабинет WB',
    };
  };
}

module.exports = { installWbCabinetTokenResolver };
