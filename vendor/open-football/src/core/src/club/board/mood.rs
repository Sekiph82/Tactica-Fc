#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BoardMood {
    pub state: BoardMoodState,
}

impl Default for BoardMood {
    fn default() -> Self {
        BoardMood {
            state: BoardMoodState::Normal,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum BoardMoodState {
    Poor,
    Normal,
    Good,
    Excellent,
}
