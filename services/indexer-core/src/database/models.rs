// 数据模型定义
// 与数据库表对应的 Rust 结构体

#[derive(Debug, Clone)]
pub struct User {
    pub handle: String,
    pub pubkey: String,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub on_chain_address: String,
    pub last_synced_slot: i64,
}

#[derive(Debug, Clone)]
pub struct Post {
    pub content_id: String,
    pub author_id: i32,
    pub text: Option<String>,
    pub content_type: String,
    pub on_chain_address: String,
    pub last_synced_slot: i64,
}

#[derive(Debug, Clone)]
pub struct Follow {
    pub follower_id: i32,
    pub following_id: i32,
    pub on_chain_address: String,
    pub last_synced_slot: i64,
}
