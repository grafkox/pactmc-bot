function hasAnyRole(member, roleIds) {
    return member?.roles?.cache?.some((role) => roleIds.includes(role.id)) ?? false;
}

module.exports = { hasAnyRole };
