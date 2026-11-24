// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title RegistryBaseline  -  FOR GAS MEASUREMENT ONLY. NEVER DEPLOY.
/// @notice This is the "first draft" registry the team would naturally write, in the style of
///         OpenZeppelin AccessControlEnumerable: per-role boolean mapping, an on-chain member list per
///         role, unpacked uint256 fields, a role counter and require(...,"string") errors.
///         It supports the same three measured operations as Registry (register, assignRole for an
///         existing user, assignRole creating a staff user) with the same observable behaviour
///         so the before/after comparison in docs/GAS_REGISTRY.md is like-for-like.
contract RegistryBaseline {
    uint8 internal constant ADMIN = 1;
    uint8 internal constant STAFF = 38; // PAUSER | VERIFIER | ARBITER
    uint8 internal constant PUBLIC = 24; // LENDER | BORROWER
    uint8 internal constant LENDER = 8;
    uint8 internal constant BORROWER = 16;
    uint8 internal constant ARBITER = 32;

    struct Profile {
        uint256 status; // 0 none, 1 pending, 2 active, 3 suspended
        uint256 registeredAt;
        uint256 verifiedAt;
        bytes32 kycRef;
        uint256 roleCount;
    }

    mapping(address => Profile) public profiles;
    mapping(bytes32 => mapping(address => bool)) public hasRoleKey; // role key => account => bool
    mapping(bytes32 => address[]) public roleMembers; // on-chain enumeration (costly!)

    event UserRegistered(address indexed user, uint8 roles, bytes32 kycRef);
    event RoleGranted(uint8 indexed role, address indexed account, address indexed sender);

    constructor(address admin_) {
        require(admin_ != address(0), "zero address");
        profiles[admin_] = Profile(2, block.timestamp, block.timestamp, bytes32(0), 0);
        _grant(ADMIN, admin_);
    }

    function register(uint8 publicRoles, bytes32 kycRef) external {
        require(publicRoles != 0 && (publicRoles & ~PUBLIC) == 0, "invalid role");
        require(kycRef != bytes32(0), "invalid kyc");
        require(profiles[msg.sender].status == 0, "already registered");
        profiles[msg.sender] = Profile(1, block.timestamp, 0, kycRef, 0);
        emit UserRegistered(msg.sender, publicRoles, kycRef);
        if (publicRoles & LENDER != 0) _grant(LENDER, msg.sender);
        if (publicRoles & BORROWER != 0) _grant(BORROWER, msg.sender);
    }

    function assignRole(address user, uint8 role) external {
        require(hasRoleKey[_key(ADMIN)][msg.sender], "AccessControl: missing role");
        require(role != 0 && role != ADMIN && role <= ARBITER && (role & (role - 1)) == 0, "invalid role");
        require(user != address(0), "zero address");
        uint256 s = profiles[user].status;
        if (s == 0) {
            require((role & STAFF) != 0, "not registered");
            profiles[user] = Profile(2, block.timestamp, block.timestamp, bytes32(0), 0);
        } else {
            require(s != 3, "suspended");
            require((role & STAFF) == 0 || s == 2, "invalid status");
        }
        _grant(role, user);
    }

    function memberCount(uint8 role) external view returns (uint256) {
        return roleMembers[_key(role)].length;
    }

    function _grant(uint8 role, address user) private {
        bytes32 k = _key(role);
        require(!hasRoleKey[k][user], "role already assigned");
        hasRoleKey[k][user] = true;
        roleMembers[k].push(user);
        profiles[user].roleCount = profiles[user].roleCount + 1;
        emit RoleGranted(role, user, msg.sender);
    }

    function _key(uint8 role) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("ROLE_", role));
    }
}
