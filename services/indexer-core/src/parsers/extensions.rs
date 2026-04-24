use std::sync::Arc;

/// 扩展事件（链上日志解析后的结构化信号）
#[derive(Debug, Clone)]
pub enum ParsedExtensionEvent {
    ContributionEngine(ContributionEngineEvent),
}

/// Contribution Engine 扩展日志事件
#[derive(Debug, Clone)]
pub enum ContributionEngineEvent {
    LedgerCreated {
        crystal_id: String,
    },
    ContributionRecorded {
        crystal_id: String,
        contributor: String,
        role: String,
    },
    ReferenceAdded {
        source_id: String,
        target_id: String,
        reference_type: String,
    },
    ReputationSettled {
        crystal_id: String,
    },
}

pub trait ExtensionLogParser: Send + Sync {
    fn parser_name(&self) -> &'static str;
    fn parse_logs(&self, logs: &[String]) -> Vec<ParsedExtensionEvent>;
}

/// 扩展日志解析注册表（Phase-1: 本地 parser 插件化骨架）
pub struct ExtensionParserRegistry {
    parsers: Vec<Arc<dyn ExtensionLogParser>>,
}

impl Default for ExtensionParserRegistry {
    fn default() -> Self {
        Self {
            parsers: vec![Arc::new(ContributionEngineLogParser)],
        }
    }
}

impl ExtensionParserRegistry {
    pub fn parse_logs(&self, logs: &[String]) -> Vec<ParsedExtensionEvent> {
        let mut events = Vec::new();
        for parser in &self.parsers {
            let parser_events = parser.parse_logs(logs);
            if !parser_events.is_empty() {
                events.extend(parser_events);
            }
        }
        events
    }

    pub fn parser_names(&self) -> Vec<&'static str> {
        self.parsers
            .iter()
            .map(|parser| parser.parser_name())
            .collect()
    }
}

/// Contribution Engine 日志解析器（基于 msg! 文本）
struct ContributionEngineLogParser;

const LEDGER_CREATED_MARKER: &str = "Contribution ledger created: crystal_id=";
const CONTRIBUTION_RECORDED_MARKER: &str = "Contribution recorded:";
const REFERENCE_ADDED_MARKER: &str = "Reference added:";
const REPUTATION_SETTLED_MARKER: &str = "Reputation settlement completed: crystal_id=";

impl ExtensionLogParser for ContributionEngineLogParser {
    fn parser_name(&self) -> &'static str {
        "contribution-engine"
    }

    fn parse_logs(&self, logs: &[String]) -> Vec<ParsedExtensionEvent> {
        let mut events = Vec::new();

        for log in logs {
            if let Some(crystal_id) = extract_field(log, LEDGER_CREATED_MARKER) {
                events.push(ParsedExtensionEvent::ContributionEngine(
                    ContributionEngineEvent::LedgerCreated { crystal_id },
                ));
                continue;
            }

            if log.contains(CONTRIBUTION_RECORDED_MARKER) {
                let crystal_id =
                    extract_field(log, "crystal=").unwrap_or_else(|| "unknown".to_string());
                let contributor =
                    extract_field(log, "contributor=").unwrap_or_else(|| "unknown".to_string());
                let role = extract_field(log, "role=").unwrap_or_else(|| "unknown".to_string());

                events.push(ParsedExtensionEvent::ContributionEngine(
                    ContributionEngineEvent::ContributionRecorded {
                        crystal_id,
                        contributor,
                        role,
                    },
                ));
                continue;
            }

            if log.contains(REFERENCE_ADDED_MARKER) {
                let source_id = extract_arrow_left(log).unwrap_or_else(|| "unknown".to_string());
                let target_id = extract_arrow_right(log).unwrap_or_else(|| "unknown".to_string());
                let reference_type =
                    extract_field(log, "type=").unwrap_or_else(|| "unknown".to_string());

                events.push(ParsedExtensionEvent::ContributionEngine(
                    ContributionEngineEvent::ReferenceAdded {
                        source_id,
                        target_id,
                        reference_type,
                    },
                ));
                continue;
            }

            if let Some(crystal_id) = extract_field(log, REPUTATION_SETTLED_MARKER) {
                events.push(ParsedExtensionEvent::ContributionEngine(
                    ContributionEngineEvent::ReputationSettled { crystal_id },
                ));
            }
        }

        events
    }
}

fn extract_field(log: &str, marker: &str) -> Option<String> {
    let start = log.find(marker)?;
    let value = &log[(start + marker.len())..];
    let normalized = value
        .split([',', ' '])
        .next()
        .unwrap_or_default()
        .trim()
        .trim_end_matches(|c: char| c == ')' || c == ';' || c == '.')
        .to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn extract_arrow_left(log: &str) -> Option<String> {
    let payload = extract_after(log, REFERENCE_ADDED_MARKER)?;
    let source = payload.split("->").next()?.trim();
    if source.is_empty() {
        None
    } else {
        Some(source.to_string())
    }
}

fn extract_after<'a>(log: &'a str, marker: &str) -> Option<&'a str> {
    log.split(marker).nth(1).map(str::trim)
}

fn extract_arrow_right(log: &str) -> Option<String> {
    let payload = log.split("->").nth(1)?.trim();
    let target = payload.split_whitespace().next()?.trim();
    if target.is_empty() {
        None
    } else {
        Some(target.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{ContributionEngineEvent, ExtensionParserRegistry, ParsedExtensionEvent};

    #[test]
    fn parses_reference_added_log_into_contribution_engine_event() {
        let registry = ExtensionParserRegistry::default();
        let logs = vec![
            "Program log: Reference added: Source111 -> Target222 type=Citation".to_string(),
        ];

        let events = registry.parse_logs(&logs);
        assert_eq!(events.len(), 1);

        match &events[0] {
            ParsedExtensionEvent::ContributionEngine(ContributionEngineEvent::ReferenceAdded {
                source_id,
                target_id,
                reference_type,
            }) => {
                assert_eq!(source_id, "Source111");
                assert_eq!(target_id, "Target222");
                assert_eq!(reference_type, "Citation");
            }
            other => panic!("expected ReferenceAdded event, got {:?}", other),
        }
    }

    #[test]
    fn registry_includes_contribution_engine_parser() {
        let registry = ExtensionParserRegistry::default();
        let parser_names = registry.parser_names();
        assert!(parser_names.contains(&"contribution-engine"));
    }
}
