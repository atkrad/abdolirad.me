---
date: '{{ .Date }}'
draft: true
slug: '{{ if eq .File.ContentBaseName "index" }}{{ path.Base (strings.TrimRight "/" .File.Dir) }}{{ else }}{{ .File.ContentBaseName }}{{ end }}'
title: '{{ if eq .File.ContentBaseName "index" }}{{ replace (path.Base (strings.TrimRight "/" .File.Dir)) "-" " " | title }}{{ else }}{{ replace .File.ContentBaseName "-" " " | title }}{{ end }}'
---
